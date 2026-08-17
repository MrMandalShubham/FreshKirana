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
 * Admin-governed: vendors do not create these, they attach offers to them
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

export type CategoryRow = typeof category.$inferSelect;
export type BrandRow = typeof brand.$inferSelect;
export type MasterProductRow = typeof masterProduct.$inferSelect;
export type NewMasterProductRow = typeof masterProduct.$inferInsert;
