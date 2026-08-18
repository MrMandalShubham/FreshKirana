import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductStatus, isValidEan, isValidHsnCode } from '@freshkirana/contracts';
import { parse } from 'csv-parse/sync';
import { logger } from '../../../observability/logger';
import { CatalogService } from './catalog.service';
import { DuplicateDetector } from './duplicate-detector';

export interface ImportRowOutcome {
  /** 1-based, counting the header — the number the operator sees in their spreadsheet. */
  row: number;
  slug?: string;
  outcome: 'CREATED' | 'DUPLICATE' | 'INVALID' | 'UNCHANGED';
  message?: string;
  duplicateOf?: string;
}

export interface ImportReport {
  total: number;
  created: number;
  duplicates: number;
  invalid: number;
  unchanged: number;
  rows: ImportRowOutcome[];
}

interface RawRow {
  [key: string]: string | undefined;
}

const REQUIRED_COLUMNS = [
  'slug',
  'name',
  'category_slug',
  'net_quantity',
  'uom',
  'hsn_code',
  'gst_rate_bp',
];

/** Guardrail on a synchronous parse: a bigger file belongs in the CLI importer. */
const MAX_ROWS = 5000;

/**
 * Bulk catalog import (spec §1.9.1, readiness item C1).
 *
 * The master catalog needs thousands of products before a single order can be
 * placed, and hand-entering them is not a plan. This turns a spreadsheet into
 * master products, refusing anything that would put a non-compliant or
 * duplicate product into the catalog.
 *
 * **Idempotent by slug**: re-running the same file creates nothing new and
 * reports UNCHANGED. Imports get re-run — after a partial failure, after a
 * correction — and a tool that duplicates its own output on the second run is
 * worse than no tool.
 */
@Injectable()
export class CatalogImportService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly duplicates: DuplicateDetector,
  ) {}

  async importFromCsv(csvText: string): Promise<ImportReport> {
    const rows = this.parseCsv(csvText);

    const report: ImportReport = {
      total: rows.length,
      created: 0,
      duplicates: 0,
      invalid: 0,
      unchanged: 0,
      rows: [],
    };

    // Sequential, not parallel: dedupe must see products created earlier in the
    // same file, or a spreadsheet listing the same product twice would insert
    // it twice.
    for (const [index, raw] of rows.entries()) {
      const rowNumber = index + 2; // +1 for zero-based, +1 for the header
      const outcome = await this.importRow(raw, rowNumber);
      report.rows.push(outcome);

      switch (outcome.outcome) {
        case 'CREATED':
          report.created += 1;
          break;
        case 'DUPLICATE':
          report.duplicates += 1;
          break;
        case 'INVALID':
          report.invalid += 1;
          break;
        case 'UNCHANGED':
          report.unchanged += 1;
          break;
      }
    }

    logger.info(
      {
        total: report.total,
        created: report.created,
        duplicates: report.duplicates,
        invalid: report.invalid,
        unchanged: report.unchanged,
      },
      'catalog import complete',
    );

    return report;
  }

  private async importRow(raw: RawRow, rowNumber: number): Promise<ImportRowOutcome> {
    const slug = raw['slug']?.trim();
    const name = raw['name']?.trim();

    const missing = REQUIRED_COLUMNS.filter((column) => !raw[column]?.trim());
    if (missing.length > 0) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: `Missing required value(s): ${missing.join(', ')}`,
      };
    }

    if (!slug || !name) {
      return {
        row: rowNumber,
        outcome: 'INVALID',
        message: 'slug and name are required',
      };
    }

    // Already imported: the idempotency guarantee.
    const existing = await this.catalog.findBySlug(slug);
    if (existing) {
      return {
        row: rowNumber,
        slug,
        outcome: 'UNCHANGED',
        message: 'Slug already imported',
      };
    }

    const netQuantity = Number(raw['net_quantity']);
    const gstRateBp = Number(raw['gst_rate_bp']);
    const uom = raw['uom']!.trim().toUpperCase();
    const hsnCode = raw['hsn_code']!.trim();
    const ean = raw['ean_barcode']?.trim() || undefined;

    if (!Number.isInteger(netQuantity) || netQuantity <= 0) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: `net_quantity must be a positive whole number in ${uom} (1.5 L is 1500 ML)`,
      };
    }

    if (!Number.isInteger(gstRateBp) || gstRateBp < 0 || gstRateBp > 5000) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: 'gst_rate_bp must be basis points, e.g. 500 for 5%',
      };
    }

    if (!isValidHsnCode(hsnCode)) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: 'hsn_code must be 4, 6 or 8 digits',
      };
    }

    if (ean && !isValidEan(ean)) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: 'ean_barcode must be 8, 12 or 13 digits',
      };
    }

    const candidates = await this.duplicates.findCandidates({
      name,
      eanBarcode: ean,
      netQuantity,
      uom,
    });

    if (candidates.length > 0) {
      const best = candidates[0]!;
      return {
        row: rowNumber,
        slug,
        outcome: 'DUPLICATE',
        duplicateOf: best.id,
        message: `Looks like "${best.name}" (${best.reason.toLowerCase().replace('_', ' ')}, score ${best.score.toFixed(2)})`,
      };
    }

    const category = await this.catalog.findCategoryBySlug(raw['category_slug']!.trim());
    if (!category) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: `Unknown category "${raw['category_slug']}" — create it before importing`,
      };
    }

    const isPrepackaged = this.toBoolean(raw['is_prepackaged'], true);
    const isVariableWeight = this.toBoolean(raw['is_variable_weight'], false);

    try {
      const created = await this.catalog.createProduct({
        slug,
        name,
        categoryId: category.id,
        netQuantity,
        uom: uom as never,
        hsnCode,
        gstRateBp,
        eanBarcode: ean,
        isPrepackaged,
        isVariableWeight,
        pricingUom: (raw['pricing_uom']?.trim().toUpperCase() as never) || undefined,
        vegMark: (raw['veg_mark']?.trim().toUpperCase() as never) || undefined,
        manufacturerPacker: raw['manufacturer_packer']?.trim() || undefined,
        countryOfOrigin: raw['country_of_origin']?.trim() || undefined,
        consumerCareContact: raw['consumer_care_contact']?.trim() || undefined,
        description: raw['description']?.trim() || undefined,
        // Imported products land as DRAFT unless the row is complete enough to
        // be lawful. The Legal Metrology check (§3.7.3) then decides.
        status: this.toBoolean(raw['activate'], false)
          ? ProductStatus.ACTIVE
          : ProductStatus.DRAFT,
      });

      return {
        row: rowNumber,
        slug,
        outcome: 'CREATED',
        duplicateOf: undefined,
        message: created?.id,
      };
    } catch (error) {
      return {
        row: rowNumber,
        slug,
        outcome: 'INVALID',
        message: (error as { message?: string }).message ?? 'Rejected',
      };
    }
  }

  private parseCsv(csvText: string): RawRow[] {
    let rows: RawRow[];
    try {
      rows = parse(csvText, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as RawRow[];
    } catch (error) {
      throw new BadRequestException(
        `Could not parse CSV: ${(error as { message?: string }).message ?? 'unknown error'}`,
      );
    }

    if (rows.length === 0) {
      throw new BadRequestException('CSV contains no data rows');
    }

    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(
        `CSV has ${rows.length} rows; the request importer accepts ${MAX_ROWS}. Use the CLI importer for larger files.`,
      );
    }

    const headers = Object.keys(rows[0] ?? {});
    const missingColumns = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missingColumns.join(', ')}`,
      );
    }

    return rows;
  }

  private toBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === '') return fallback;
    return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
  }
}
