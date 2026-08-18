import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';

export interface DuplicateCandidate {
  id: string;
  name: string;
  slug: string;
  eanBarcode: string | null;
  /** 1 for a barcode match; otherwise trigram similarity in [0,1). */
  score: number;
  reason: 'EAN_MATCH' | 'NAME_SIMILARITY';
}

/**
 * Similarity above which two products with the same size are treated as the
 * same thing.
 *
 * Tuned deliberately low. A false positive costs an admin one click to
 * override; a false negative puts a duplicate in the catalog, which breaks
 * search dedup and price comparison — the whole point of decision D1 — and is
 * far more expensive to unpick later.
 */
const NAME_SIMILARITY_THRESHOLD = 0.45;

/**
 * Finds master products that a candidate is probably a duplicate of
 * (spec §2.4.1).
 *
 * Two signals, in order of trust:
 *  1. **Barcode** — an exact EAN match is definitive. Same barcode, same product.
 *  2. **Name similarity at the same size** — catches "Aashirvaad Atta 5kg",
 *     "Aashirvaad Whole Wheat Atta 5 kg" and "AASHIRVAAD ATTA 5KG". Net
 *     quantity must match, because a 1kg and a 5kg pack are genuinely
 *     different products despite near-identical names.
 */
@Injectable()
export class DuplicateDetector {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findCandidates(input: {
    name: string;
    eanBarcode?: string | null;
    netQuantity?: number | null;
    uom?: string | null;
    excludeId?: string;
  }): Promise<DuplicateCandidate[]> {
    const candidates: DuplicateCandidate[] = [];

    if (input.eanBarcode) {
      const byEan = await this.db.execute<{
        id: string;
        name: string;
        slug: string;
        ean_barcode: string | null;
      }>(sql`
        select id, name, slug, ean_barcode
        from catalog.master_product
        where ean_barcode = ${input.eanBarcode}
          and status <> 'ARCHIVED'
        limit 5
      `);

      for (const row of byEan.rows) {
        if (row.id === input.excludeId) continue;
        candidates.push({
          id: row.id,
          name: row.name,
          slug: row.slug,
          eanBarcode: row.ean_barcode,
          score: 1,
          reason: 'EAN_MATCH',
        });
      }
    }

    // A barcode match is definitive; no point offering weaker guesses too.
    if (candidates.length > 0) return candidates;

    const bySimilarity = await this.db.execute<{
      id: string;
      name: string;
      slug: string;
      ean_barcode: string | null;
      score: number;
    }>(sql`
      select id, name, slug, ean_barcode,
             similarity(name, ${input.name}) as score
      from catalog.master_product
      where status <> 'ARCHIVED'
        and similarity(name, ${input.name}) > ${NAME_SIMILARITY_THRESHOLD}
        ${
          input.netQuantity != null && input.uom
            ? sql`and net_quantity = ${input.netQuantity} and uom = ${input.uom}`
            : sql``
        }
      order by score desc
      limit 5
    `);

    for (const row of bySimilarity.rows) {
      if (row.id === input.excludeId) continue;
      candidates.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        eanBarcode: row.ean_barcode,
        score: Number(row.score),
        reason: 'NAME_SIMILARITY',
      });
    }

    return candidates;
  }
}
