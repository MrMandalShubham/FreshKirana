import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMode } from '@freshkirana/contracts';
import { and, count, desc, eq, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { CatalogService, ProductStatus } from '../../catalog/contracts';
import { VendorService, VendorStatus } from '../../vendor/contracts';
import { vendorOffer } from '../schema';
import {
  type CreateOfferDto,
  type ListOffersQueryDto,
  OfferStatus,
  type UpdateOfferDto,
} from './offer.dto';

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function pgConstraint(error: unknown): string | undefined {
  return (error as { constraint?: string } | null)?.constraint;
}

@Injectable()
export class OfferService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly vendors: VendorService,
  ) {}

  /**
   * Creates a vendor's listing for a master product.
   *
   * Existence of both sides is checked through the owning modules' contracts.
   * There are no cross-schema foreign keys (see schema.ts), so this check *is*
   * the referential integrity — skipping it would let an offer point at a
   * product that never existed.
   */
  async create(vendorId: string, dto: CreateOfferDto) {
    const vendor = await this.vendors.findById(vendorId);
    if (vendor.status === VendorStatus.SUSPENDED) {
      throw new BadRequestException('A suspended vendor cannot create listings');
    }

    const product = await this.catalog.getProduct(dto.masterProductId);
    if (product.status === ProductStatus.ARCHIVED) {
      throw new BadRequestException(
        `Master product ${dto.masterProductId} is archived and cannot take new offers`,
      );
    }

    this.assertPricingIsLawful(dto.sellingPricePaise, dto.mrpPaise);

    const inventoryMode = dto.inventoryMode ?? vendor.defaultInventoryMode;

    try {
      const rows = await this.db
        .insert(vendorOffer)
        .values({
          vendorId,
          masterProductId: dto.masterProductId,
          mrpPaise: dto.mrpPaise,
          sellingPricePaise: dto.sellingPricePaise,
          inventoryMode,
          stockOnHand: dto.stockOnHand ?? 0,
          lowStockThreshold: dto.lowStockThreshold ?? 0,
          isAvailable: dto.isAvailable ?? true,
          batchNo: dto.batchNo ?? null,
          mfgDate: dto.mfgDate ?? null,
          expiryDate: dto.expiryDate ?? null,
        })
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async findForVendor(vendorId: string, offerId: string) {
    const rows = await this.db
      .select()
      .from(vendorOffer)
      .where(and(eq(vendorOffer.id, offerId), eq(vendorOffer.vendorId, vendorId)))
      .limit(1);

    const found = rows[0];
    if (!found) {
      // Scoped by vendor deliberately: another vendor's offer is *not found*
      // here, never "forbidden". Distinguishing the two would leak the fact
      // that a given offer exists (§3.2).
      throw new NotFoundException(`Offer ${offerId} not found for this vendor`);
    }
    return found;
  }

  async update(vendorId: string, offerId: string, dto: UpdateOfferDto) {
    const existing = await this.findForVendor(vendorId, offerId);

    const mrp = dto.mrpPaise ?? existing.mrpPaise;
    const price = dto.sellingPricePaise ?? existing.sellingPricePaise;
    this.assertPricingIsLawful(price, mrp);

    const stockOnHand = dto.stockOnHand ?? existing.stockOnHand;
    if (stockOnHand < existing.stockReserved) {
      throw new BadRequestException(
        `Cannot set stock to ${stockOnHand}: ${existing.stockReserved} unit(s) are reserved by in-flight checkouts (§2.5)`,
      );
    }

    try {
      const rows = await this.db
        .update(vendorOffer)
        .set({ ...dto, updatedAt: new Date() })
        .where(and(eq(vendorOffer.id, offerId), eq(vendorOffer.vendorId, vendorId)))
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async listForVendor(vendorId: string, query: ListOffersQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const filters: SQL[] = [eq(vendorOffer.vendorId, vendorId)];
    if (query.status) filters.push(eq(vendorOffer.status, query.status));
    if (query.lowStockOnly) {
      filters.push(lte(vendorOffer.stockOnHand, vendorOffer.lowStockThreshold));
    }

    const where = and(...filters);

    const [items, total] = await Promise.all([
      this.db
        .select()
        .from(vendorOffer)
        .where(where)
        .orderBy(desc(vendorOffer.updatedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ value: count() }).from(vendorOffer).where(where),
    ]);

    return { items, total: total[0]?.value ?? 0, limit, offset };
  }

  /** Offers for one master product, across vendors. Used by search (P1.4). */
  async listForProduct(masterProductId: string) {
    return this.db
      .select()
      .from(vendorOffer)
      .where(
        and(
          eq(vendorOffer.masterProductId, masterProductId),
          eq(vendorOffer.status, OfferStatus.ACTIVE),
        ),
      );
  }

  /**
   * Whether an offer can actually be bought right now (§1.9.2).
   *
   * Deliberately mode-aware: a TOGGLE-mode vendor keeps no counts, so demanding
   * `stockOnHand > 0` would make every such shop permanently out of stock. That
   * is the accommodation the tiered inventory model exists to make.
   */
  isPurchasable(offer: {
    status: string;
    isAvailable: boolean;
    inventoryMode: string;
    stockOnHand: number;
    stockReserved: number;
  }): boolean {
    if (offer.status !== OfferStatus.ACTIVE || !offer.isAvailable) return false;
    if (offer.inventoryMode === InventoryMode.QUANTITY) {
      return offer.stockOnHand - offer.stockReserved > 0;
    }
    return true;
  }

  private assertPricingIsLawful(sellingPricePaise: number, mrpPaise: number): void {
    if (sellingPricePaise > mrpPaise) {
      throw new BadRequestException(
        'Selling price cannot exceed MRP — selling above the printed maximum retail price is unlawful in India',
      );
    }
  }

  private translateWriteError(error: unknown): unknown {
    if (pgCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException(
        'This vendor already has an offer for that product — update it instead of creating a second one',
      );
    }

    if (pgCode(error) === PG_CHECK_VIOLATION) {
      switch (pgConstraint(error)) {
        case 'vendor_offer_price_not_above_mrp':
          return new BadRequestException('Selling price cannot exceed MRP');
        case 'vendor_offer_reserved_within_stock':
          return new BadRequestException(
            'Reserved stock would exceed stock on hand — this would oversell (§2.5)',
          );
        case 'vendor_offer_expiry_after_mfg':
          return new BadRequestException('Expiry date cannot precede manufacture date');
        default:
          return new BadRequestException(
            `Offer violates constraint ${pgConstraint(error)}`,
          );
      }
    }

    return error;
  }
}
