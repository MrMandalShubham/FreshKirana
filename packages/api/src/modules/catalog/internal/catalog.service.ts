import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus, missingLegalMetrologyFields } from '@freshkirana/contracts';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { brand, category, masterProduct } from '../schema';
import type {
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './catalog.dto';

/** Postgres unique-violation / check-violation codes. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function pgConstraint(error: unknown): string | undefined {
  return (error as { constraint?: string } | null)?.constraint;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async createCategory(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.db
        .select({ id: category.id })
        .from(category)
        .where(eq(category.id, dto.parentId))
        .limit(1);
      if (parent.length === 0) {
        throw new BadRequestException(`Parent category ${dto.parentId} does not exist`);
      }
    }

    try {
      const rows = await this.db
        .insert(category)
        .values({
          slug: dto.slug,
          name: dto.name,
          nameI18n: dto.nameI18n ?? {},
          parentId: dto.parentId ?? null,
          displayOrder: dto.displayOrder ?? 0,
        })
        .returning();
      return rows[0];
    } catch (error) {
      if (pgCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`Category slug "${dto.slug}" already exists`);
      }
      throw error;
    }
  }

  async listCategories() {
    return this.db
      .select()
      .from(category)
      .orderBy(asc(category.displayOrder), asc(category.name));
  }

  // -------------------------------------------------------------------------
  // Brands
  // -------------------------------------------------------------------------

  async createBrand(dto: CreateBrandDto) {
    try {
      const rows = await this.db.insert(brand).values(dto).returning();
      return rows[0];
    } catch (error) {
      if (pgCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`Brand slug "${dto.slug}" already exists`);
      }
      throw error;
    }
  }

  async listBrands() {
    return this.db.select().from(brand).orderBy(asc(brand.name));
  }

  // -------------------------------------------------------------------------
  // Master products
  // -------------------------------------------------------------------------

  async createProduct(dto: CreateProductDto) {
    const status = dto.status ?? ProductStatus.DRAFT;
    const isPrepackaged = dto.isPrepackaged ?? true;

    await this.assertReferencesExist(dto.categoryId, dto.brandId);
    this.assertVariableWeightIsCoherent(dto.isVariableWeight ?? false, dto.pricingUom);

    // Checked here to return a clear, field-level message. The database CHECK
    // is the actual guarantee (§3.7.3) — this is the good error, not the rule.
    if (status === ProductStatus.ACTIVE) {
      this.assertLegalMetrologyComplete({ ...dto, isPrepackaged });
    }

    try {
      const rows = await this.db
        .insert(masterProduct)
        .values({
          slug: dto.slug,
          name: dto.name,
          nameI18n: dto.nameI18n ?? {},
          description: dto.description ?? null,
          categoryId: dto.categoryId,
          brandId: dto.brandId ?? null,
          netQuantity: dto.netQuantity,
          uom: dto.uom,
          isVariableWeight: dto.isVariableWeight ?? false,
          pricingUom: dto.pricingUom ?? null,
          weightTolerancePct: dto.weightTolerancePct ?? 10,
          isPrepackaged,
          eanBarcode: dto.eanBarcode ?? null,
          hsnCode: dto.hsnCode,
          gstRateBp: dto.gstRateBp,
          vegMark: dto.vegMark ?? 'VEG',
          manufacturerPacker: dto.manufacturerPacker ?? null,
          countryOfOrigin: dto.countryOfOrigin ?? null,
          consumerCareContact: dto.consumerCareContact ?? null,
          attributes: dto.attributes ?? {},
          images: dto.images ?? [],
          status,
        })
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translateWriteError(error, dto.slug, dto.eanBarcode);
    }
  }

  /** Null rather than throwing: the importer uses this to detect re-runs. */
  async findBySlug(slug: string) {
    const rows = await this.db
      .select()
      .from(masterProduct)
      .where(eq(masterProduct.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryBySlug(slug: string) {
    const rows = await this.db
      .select()
      .from(category)
      .where(eq(category.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async getProduct(id: string) {
    const rows = await this.db
      .select()
      .from(masterProduct)
      .where(eq(masterProduct.id, id))
      .limit(1);

    const found = rows[0];
    if (!found) throw new NotFoundException(`Product ${id} not found`);
    return found;
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const existing = await this.getProduct(id);

    const merged = { ...existing, ...dto };
    this.assertVariableWeightIsCoherent(merged.isVariableWeight, merged.pricingUom);

    if (merged.status === ProductStatus.ACTIVE) {
      this.assertLegalMetrologyComplete(merged);
    }

    try {
      const rows = await this.db
        .update(masterProduct)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(masterProduct.id, id))
        .returning();
      return rows[0];
    } catch (error) {
      // Slug is immutable after creation, so it is never the cause here.
      throw this.translateWriteError(error, existing.slug, dto.eanBarcode);
    }
  }

  async listProducts(query: ListProductsQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const filters: SQL[] = [];
    if (query.categoryId) filters.push(eq(masterProduct.categoryId, query.categoryId));
    if (query.status) filters.push(eq(masterProduct.status, query.status));
    if (query.search) {
      const term = `%${query.search}%`;
      const match = or(ilike(masterProduct.name, term), ilike(masterProduct.slug, term));
      if (match) filters.push(match);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [items, total] = await Promise.all([
      this.db
        .select()
        .from(masterProduct)
        .where(where)
        .orderBy(desc(masterProduct.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(masterProduct).where(where),
    ]);

    return { items, total: total[0]?.value ?? 0, limit, offset };
  }

  // -------------------------------------------------------------------------

  private assertLegalMetrologyComplete(input: {
    isPrepackaged: boolean;
    manufacturerPacker?: string | null;
    countryOfOrigin?: string | null;
    consumerCareContact?: string | null;
  }): void {
    const missing = missingLegalMetrologyFields(input);
    if (missing.length > 0) {
      throw new BadRequestException(
        `A pre-packaged product cannot be ACTIVE without its Legal Metrology declarations (§3.7.3). Missing: ${missing.join(', ')}`,
      );
    }
  }

  private assertVariableWeightIsCoherent(
    isVariableWeight: boolean,
    pricingUom: string | null | undefined,
  ): void {
    if (isVariableWeight && !pricingUom) {
      throw new BadRequestException(
        'A variable-weight product must declare pricingUom — the price is per unit of weight (§1.7.1)',
      );
    }
  }

  private async assertReferencesExist(
    categoryId: string,
    brandId?: string,
  ): Promise<void> {
    const found = await this.db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.id, categoryId))
      .limit(1);
    if (found.length === 0) {
      throw new BadRequestException(`Category ${categoryId} does not exist`);
    }

    if (brandId) {
      const b = await this.db
        .select({ id: brand.id })
        .from(brand)
        .where(eq(brand.id, brandId))
        .limit(1);
      if (b.length === 0)
        throw new BadRequestException(`Brand ${brandId} does not exist`);
    }
  }

  /** Turns Postgres constraint violations into messages that name the actual problem. */
  private translateWriteError(error: unknown, slug?: string, ean?: string): unknown {
    if (pgCode(error) === PG_UNIQUE_VIOLATION) {
      const constraint = pgConstraint(error);
      if (constraint === 'master_product_ean_key') {
        return new ConflictException(
          `Barcode ${ean} is already on another master product — this is probably a duplicate (§2.4.1)`,
        );
      }
      return new ConflictException(`Product slug "${slug}" already exists`);
    }

    if (pgCode(error) === PG_CHECK_VIOLATION) {
      const constraint = pgConstraint(error);
      if (constraint === 'master_product_legal_metrology') {
        return new BadRequestException(
          'Database rejected an ACTIVE pre-packaged product without its Legal Metrology declarations (§3.7.3)',
        );
      }
      return new BadRequestException(`Product violates constraint ${constraint}`);
    }

    return error;
  }
}
