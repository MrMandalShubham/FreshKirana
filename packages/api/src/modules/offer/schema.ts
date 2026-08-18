import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the offer module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const offerSchema = pgSchema('offer');

/**
 * One vendor's price and stock for one master product (spec §2.4.1, decision D1).
 *
 * The master product says *what* the thing is; the offer says *who sells it, at
 * what price, and whether they have any*. Search ranks master products and
 * resolves offers at render time, which is what keeps one atta one search result.
 *
 * ## Why there are no foreign keys to catalog or vendor
 *
 * `masterProductId` and `vendorId` are plain UUIDs, not FK references. A
 * cross-schema foreign key would couple this module's tables to another
 * module's internals — exactly what §2.1.1 forbids, and what would make the
 * §2.1.2 extraction triggers expensive to act on later.
 *
 * The trade is real and worth stating: we give up database-level referential
 * integrity and take on the duty of validating existence through the owning
 * module's `contracts.ts` before writing, plus an integrity sweep to catch
 * orphans. That is the price of module boundaries that actually hold.
 */
export const vendorOffer = offerSchema.table(
  'vendor_offer',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by the vendor module. Validated via its contracts, never joined. */
    vendorId: uuid('vendor_id').notNull(),
    /** Owned by the catalog module. Validated via its contracts, never joined. */
    masterProductId: uuid('master_product_id').notNull(),

    /** Integer paise, like all money (see contracts' Money). */
    mrpPaise: integer('mrp_paise').notNull(),
    sellingPricePaise: integer('selling_price_paise').notNull(),

    /** TOGGLE | THRESHOLD | QUANTITY — the §1.9.2 accuracy tier. */
    inventoryMode: text('inventory_mode').notNull().default('TOGGLE'),

    /** Meaningful only in QUANTITY mode; the other tiers use `isAvailable`. */
    stockOnHand: integer('stock_on_hand').notNull().default(0),
    /** Held by in-flight checkouts (§2.5). Reservations land in P3.1. */
    stockReserved: integer('stock_reserved').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(0),

    /** The whole signal in TOGGLE mode, and an override in the others. */
    isAvailable: boolean('is_available').notNull().default(true),

    // Perishables (§1.7.3). FEFO picking and the recall workflow arrive in P4.3.
    batchNo: text('batch_no'),
    mfgDate: date('mfg_date'),
    expiryDate: date('expiry_date'),

    /** Per-slot availability once slots exist (P2.2). */
    slotAvailability: jsonb('slot_availability').notNull().default({}),

    /** ACTIVE | PAUSED | ARCHIVED */
    status: text('status').notNull().default('ACTIVE'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // One offer per vendor per product: two would make "the price" ambiguous.
    uniqueIndex('vendor_offer_unique').on(table.vendorId, table.masterProductId),

    // Search resolving offers for a product across serviceable vendors.
    index('vendor_offer_product_idx').on(table.masterProductId, table.status),
    index('vendor_offer_vendor_idx').on(table.vendorId, table.status),
    // The vendor dashboard's low-stock list (§1.5.2).
    index('vendor_offer_low_stock_idx')
      .on(table.vendorId)
      .where(sql`${table.stockOnHand} <= ${table.lowStockThreshold}`),
    // FEFO picking and expiry sweeps (§1.7.3).
    index('vendor_offer_expiry_idx')
      .on(table.expiryDate)
      .where(sql`${table.expiryDate} is not null`),

    check('vendor_offer_mrp_positive', sql`${table.mrpPaise} > 0`),
    check('vendor_offer_price_positive', sql`${table.sellingPricePaise} > 0`),

    /**
     * Selling above MRP is illegal in India, not merely undesirable, so it is a
     * constraint rather than a validation. A vendor mistyping a price cannot
     * put an unlawful listing on sale.
     */
    check(
      'vendor_offer_price_not_above_mrp',
      sql`${table.sellingPricePaise} <= ${table.mrpPaise}`,
    ),

    check('vendor_offer_stock_non_negative', sql`${table.stockOnHand} >= 0`),
    check('vendor_offer_reserved_non_negative', sql`${table.stockReserved} >= 0`),

    /**
     * Reserved stock can never exceed stock on hand — that is the oversell
     * condition §2.5 exists to prevent, asserted at the lowest level so no
     * reservation bug in P3.1 can quietly breach it.
     */
    check(
      'vendor_offer_reserved_within_stock',
      sql`${table.stockReserved} <= ${table.stockOnHand}`,
    ),

    check(
      'vendor_offer_expiry_after_mfg',
      sql`${table.mfgDate} is null or ${table.expiryDate} is null or ${table.expiryDate} >= ${table.mfgDate}`,
    ),
  ],
);

export type VendorOfferRow = typeof vendorOffer.$inferSelect;
export type NewVendorOfferRow = typeof vendorOffer.$inferInsert;
