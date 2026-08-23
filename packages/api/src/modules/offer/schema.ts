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

/**
 * One physical lot of a product at one store (spec §1.7.3).
 *
 * ## Why batches are rows rather than columns
 *
 * P1.2 put `batch_no`, `mfg_date` and `expiry_date` on the offer itself, which
 * says a store holds exactly one lot of anything. Real shops hold two: the
 * crate from Monday and the crate from Thursday, expiring days apart. §1.7.3
 * needs both — FEFO picks the older one first, and a recall names *a batch*,
 * not a product.
 *
 * The offer's own columns stay as they are. They describe the lot a store is
 * currently selling from, which is what search and the product page read, and
 * rewriting that in this part would touch every screen for no gain.
 *
 * `stock_on_hand` on the offer also stays authoritative for reservations: P3.1
 * guards it with a single atomic statement that is correct and hard-won, and
 * moving stock into batches would mean rewriting that guarantee. The quantity
 * here is the traceability record — what arrived, what is left of it — and the
 * two are reconciled by the store, not by this code. See the deferral.
 */
export const offerBatch = offerSchema.table(
  'offer_batch',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    vendorOfferId: uuid('vendor_offer_id')
      .notNull()
      .references(() => vendorOffer.id, { onDelete: 'cascade' }),

    /** The lot code printed on the pack. What a recall names. */
    batchNo: text('batch_no').notNull(),
    mfgDate: date('mfg_date'),
    expiryDate: date('expiry_date'),

    /** Units received, and how many are left, in the product's own unit. */
    receivedQuantity: integer('received_quantity').notNull().default(0),
    remainingQuantity: integer('remaining_quantity').notNull().default(0),

    /** ACTIVE, DELISTED, RECALLED or DEPLETED (§1.7.3). */
    status: text('status').notNull().default('ACTIVE'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per lot per offer. The same batch number arriving twice is the
    // same lot, and two rows for it would split a recall in half.
    uniqueIndex('offer_batch_unique').on(table.vendorOfferId, table.batchNo),

    // FEFO reads this on every picking list.
    index('offer_batch_fefo_idx').on(table.vendorOfferId, table.status, table.expiryDate),

    // The shelf-life sweep, and the recall search by expiry.
    index('offer_batch_expiry_idx')
      .on(table.expiryDate)
      .where(sql`${table.expiryDate} is not null`),

    check(
      'offer_batch_dates_ordered',
      sql`${table.mfgDate} is null or ${table.expiryDate} is null or ${table.expiryDate} >= ${table.mfgDate}`,
    ),
    check('offer_batch_remaining_sane', sql`${table.remainingQuantity} >= 0`),
  ],
);

/**
 * A withdrawal, and the record a regulator will ask for (spec §1.7.3).
 *
 * Kept as a row rather than reconstructed from batch statuses, because a recall
 * is an *event* with a time, a reason and a person attached — and FSSAI wants
 * to know when the sale was blocked and when customers were told, neither of
 * which a status flag records.
 */
export const recall = offerSchema.table(
  'recall',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by catalog. Validated through contracts, never joined. */
    masterProductId: uuid('master_product_id').notNull(),
    /** The manufacturer's lot code, which is what a recall actually names. */
    batchNo: text('batch_no').notNull(),

    reason: text('reason').notNull(),
    note: text('note'),
    status: text('status').notNull().default('OPEN'),

    /** Who ordered it. A recall is never anonymous. */
    raisedBy: uuid('raised_by').notNull(),

    /** How far it reached, snapshotted when the report is produced. */
    batchesAffected: integer('batches_affected').notNull().default(0),
    ordersAffected: integer('orders_affected').notNull().default(0),
    customersNotified: integer('customers_notified').notNull().default(0),

    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    // One open recall per lot. Two would notify the same customers twice and
    // produce two reports that disagree.
    uniqueIndex('recall_open_batch_key')
      .on(table.masterProductId, table.batchNo)
      .where(sql`status <> 'CLOSED'`),
    index('recall_status_idx').on(table.status, table.raisedAt),
  ],
);

export type VendorOfferRow = typeof vendorOffer.$inferSelect;
export type OfferBatchRow = typeof offerBatch.$inferSelect;
export type RecallRow = typeof recall.$inferSelect;
export type NewVendorOfferRow = typeof vendorOffer.$inferInsert;
