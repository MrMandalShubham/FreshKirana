import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
 * Tables owned by the catalog module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const catalogSchema = pgSchema('catalog');

/** Product taxonomy. Self-referencing, so Staples > Flour > Atta is expressible. */
export const category = catalogSchema.table(
  'category',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Translations keyed by locale, e.g. {"hi":"आटा"} — §4.1 requires product names to translate, not just UI chrome. */
    nameI18n: jsonb('name_i18n').notNull().default({}),
    parentId: uuid('parent_id'),
    displayOrder: integer('display_order').notNull().default(0),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('category_slug_key').on(table.slug),
    index('category_parent_idx').on(table.parentId),
  ],
);

export const brand = catalogSchema.table(
  'brand',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex('brand_slug_key').on(table.slug)],
);

/**
 * The canonical description of a purchasable thing (spec §2.4.1, decision D1).
 *
 * Admin-governed: branches do not create these, they attach offers to them
 * (P1.2). That is what keeps search deduplicated and price comparison possible.
 */
export const masterProduct = catalogSchema.table(
  'master_product',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),

    brandId: uuid('brand_id').references(() => brand.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),

    name: text('name').notNull(),
    nameI18n: jsonb('name_i18n').notNull().default({}),
    description: text('description'),

    /**
     * Net quantity as a whole number in `uom`: 500 G, 5 KG, 1 L.
     *
     * Integer rather than decimal for the same reason money is integer paise —
     * "1.5 L" is stored as 1500 ML, so no fractional quantity ever exists to
     * round inconsistently.
     */
    netQuantity: integer('net_quantity').notNull(),
    uom: text('uom').notNull(),

    /** Loose goods priced by weight (§1.7.1). Drives the auth/capture flow at P4.2. */
    isVariableWeight: boolean('is_variable_weight').notNull().default(false),
    pricingUom: text('pricing_uom'),
    weightTolerancePct: integer('weight_tolerance_pct').notNull().default(10),

    /**
     * Pre-packaged in the Legal Metrology sense (§3.7.3).
     *
     * Distinct from `isVariableWeight`: a whole coconut is neither pre-packaged
     * nor variable-weight. Only this flag governs whether the declarations
     * below are mandatory.
     */
    isPrepackaged: boolean('is_prepackaged').notNull().default(true),

    eanBarcode: text('ean_barcode'),

    /** Tax identity. Required on every product — §3.7.1 makes it a catalog concern. */
    hsnCode: text('hsn_code').notNull(),
    /** Basis points: 500 is 5.00%. Integer, so tax arithmetic never drifts. */
    gstRateBp: integer('gst_rate_bp').notNull(),

    /** VEG | NON_VEG | EGG — mandatory marking on Indian food listings. */
    vegMark: text('veg_mark').notNull().default('VEG'),

    // Legal Metrology (Packaged Commodities) Rules declarations (§3.7.3).
    manufacturerPacker: text('manufacturer_packer'),
    countryOfOrigin: text('country_of_origin'),
    consumerCareContact: text('consumer_care_contact'),

    /** Free-form facets used for filtering, e.g. {"organic":true}. */
    attributes: jsonb('attributes').notNull().default({}),
    images: text('images')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    status: text('status').notNull().default('DRAFT'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('master_product_slug_key').on(table.slug),
    // Partial: many regional goods have no barcode, and NULLs must not collide.
    uniqueIndex('master_product_ean_key')
      .on(table.eanBarcode)
      .where(sql`${table.eanBarcode} is not null`),
    index('master_product_category_idx').on(table.categoryId, table.status),
    index('master_product_brand_idx').on(table.brandId),
    index('master_product_status_idx').on(table.status),

    /**
     * The Legal Metrology rule, enforced in the database rather than only in a
     * DTO (§3.7.3).
     *
     * Validation in one service is a convention; a constraint is a guarantee.
     * A bulk import, a migration backfill or a future admin tool cannot bypass
     * this and put a non-compliant pre-packaged product on sale.
     */
    check(
      'master_product_legal_metrology',
      sql`
        ${table.status} <> 'ACTIVE'
        or ${table.isPrepackaged} = false
        or (
          ${table.manufacturerPacker} is not null and btrim(${table.manufacturerPacker}) <> ''
          and ${table.countryOfOrigin} is not null and btrim(${table.countryOfOrigin}) <> ''
          and ${table.consumerCareContact} is not null and btrim(${table.consumerCareContact}) <> ''
        )
      `,
    ),

    check('master_product_net_quantity_positive', sql`${table.netQuantity} > 0`),
    check(
      'master_product_gst_rate_sane',
      sql`${table.gstRateBp} >= 0 and ${table.gstRateBp} <= 5000`,
    ),
    check(
      'master_product_hsn_shape',
      sql`${table.hsnCode} ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'`,
    ),
    // A variable-weight product must say what unit it is priced in.
    check(
      'master_product_variable_weight_pricing',
      sql`${table.isVariableWeight} = false or ${table.pricingUom} is not null`,
    ),
  ],
);

/**
 * A branch asking for a product the master catalog does not yet have
 * (spec §1.9.1, §2.4.1).
 *
 * This is the release valve on decision D1. Branches cannot create master
 * products — that is what keeps search deduplicated — but a kirana stocking a
 * regional brand nobody has catalogued must have some way to sell it. They
 * submit; an admin creates the canonical product; their offer attaches
 * automatically.
 *
 * Without this queue, D1 would simply mean "you cannot sell what we have not
 * thought of", and branch adoption (§1.9) would stall on day one.
 */
export const productRequest = catalogSchema.table(
  'product_request',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by the branch module — validated via contracts, never joined. */
    branchId: uuid('branch_id').notNull(),
    /** Owned by identity. Who to tell when this is resolved. */
    requestedByAccountId: uuid('requested_by_account_id'),

    /** Scanned at the shelf where available; the strongest dedupe signal. */
    eanBarcode: text('ean_barcode'),

    /** What the branch typed. Deliberately loose — they are describing, not cataloguing. */
    proposedName: text('proposed_name').notNull(),
    proposedBrand: text('proposed_brand'),
    proposedNetQuantity: integer('proposed_net_quantity'),
    proposedUom: text('proposed_uom'),
    categoryHint: text('category_hint'),
    notes: text('notes'),
    images: text('images')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /**
     * Price and stock to apply if this is approved, so the branch is not asked
     * twice. The offer is created for them on approval.
     */
    desiredMrpPaise: integer('desired_mrp_paise'),
    desiredSellingPricePaise: integer('desired_selling_price_paise'),
    desiredStockOnHand: integer('desired_stock_on_hand'),

    /** PENDING | APPROVED | REJECTED | DUPLICATE */
    status: text('status').notNull().default('PENDING'),

    /** Set on approval, or on rejection as a duplicate — points at the real product. */
    resolvedMasterProductId: uuid('resolved_master_product_id'),
    reviewerNotes: text('reviewer_notes'),
    reviewedByAccountId: uuid('reviewed_by_account_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // The admin queue's only query: oldest pending first.
    index('product_request_status_idx').on(table.status, table.createdAt),
    index('product_request_branch_idx').on(table.branchId, table.status),
    index('product_request_ean_idx')
      .on(table.eanBarcode)
      .where(sql`${table.eanBarcode} is not null`),

    /**
     * A resolved request must say what it resolved to, and a pending one must
     * not pretend to have. Otherwise the queue silently loses the link between
     * "we asked for this" and "here is the product you got".
     */
    check(
      'product_request_resolution_coherent',
      sql`
        (${table.status} = 'PENDING' and ${table.resolvedMasterProductId} is null)
        or (${table.status} = 'REJECTED')
        or (${table.status} in ('APPROVED', 'DUPLICATE') and ${table.resolvedMasterProductId} is not null)
      `,
    ),

    check(
      'product_request_price_within_mrp',
      sql`
        ${table.desiredMrpPaise} is null
        or ${table.desiredSellingPricePaise} is null
        or ${table.desiredSellingPricePaise} <= ${table.desiredMrpPaise}
      `,
    ),
  ],
);

export type ProductRequestRow = typeof productRequest.$inferSelect;
export type NewProductRequestRow = typeof productRequest.$inferInsert;

export type CategoryRow = typeof category.$inferSelect;
export type BrandRow = typeof brand.$inferSelect;
export type MasterProductRow = typeof masterProduct.$inferSelect;
export type NewMasterProductRow = typeof masterProduct.$inferInsert;
