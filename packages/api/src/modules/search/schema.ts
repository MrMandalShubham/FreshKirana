import { sql } from 'drizzle-orm';
import {
  boolean,
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
 * Tables owned by the search module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const searchSchema = pgSchema('search');

/**
 * Query expansion, editable by ops without a deploy (spec §2.7.2).
 *
 * This is the part of search that actually matters in India, and it is
 * deliberately *data* rather than code: `kanda` is onion in Maharashtra and
 * `dungri` is onion in Gujarat, and nobody discovers that list up front. Ops
 * add terms weekly from failed searches (§2.7.4) without waiting on a release.
 */
export const synonym = searchSchema.table(
  'synonym',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** The typed term, already normalised by prepareQuery. */
    term: text('term').notNull(),

    /** Everything this term should also match. */
    expansions: text('expansions').array().notNull(),

    /**
     * Locale or region this applies to; null means everywhere. Regional names
     * conflict, so the same term can expand differently by city.
     */
    locale: text('locale'),

    /** TRANSLITERATION | REGIONAL_NAME | BRAND | CATEGORY | MISSPELLING */
    kind: text('kind').notNull().default('REGIONAL_NAME'),

    isActive: boolean('is_active').notNull().default(true),
    createdByAccountId: uuid('created_by_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // COALESCE rather than a plain unique index: PostgreSQL treats NULLs as
    // distinct, so a global synonym (locale IS NULL) could otherwise be added
    // repeatedly for the same term. Same reason as identity.account_role.
    uniqueIndex('synonym_term_locale_key').on(
      table.term,
      sql`coalesce(${table.locale}, '*')`,
    ),
    index('synonym_active_idx').on(table.isActive),
  ],
);

/**
 * The search index: a projection of catalog and offer that this module owns.
 *
 * Search needs to rank across product attributes *and* live availability in one
 * query, which it cannot do by joining into other modules' schemas (§2.1.1).
 * So it keeps its own denormalised copy, exactly as an external engine would —
 * which is also what makes swapping in Typesense later (§2.1.2 trigger) a new
 * implementation rather than a rewrite.
 *
 * The trade is staleness: this is only as fresh as its last sync. §2.7.4 wants
 * stock changes visible within ten seconds, so the sync is cheap and
 * incremental rather than a full rebuild.
 */
export const productIndex = searchSchema.table(
  'product_index',
  {
    /** Mirrors catalog's master_product id. Not a foreign key — see offer/schema.ts. */
    masterProductId: uuid('master_product_id').primaryKey(),

    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameI18n: jsonb('name_i18n').notNull().default({}),
    brand: text('brand'),
    categoryId: uuid('category_id').notNull(),

    netQuantity: integer('net_quantity').notNull(),
    uom: text('uom').notNull(),
    vegMark: text('veg_mark').notNull(),
    imageUrl: text('image_url'),

    /** Only ACTIVE products are searchable; DRAFT ones are half-catalogued. */
    productStatus: text('product_status').notNull(),

    // --- Availability, denormalised from offers so ranking is a single scan ---

    /** Cheapest purchasable offer in paise; null when nobody stocks it. */
    minPricePaise: integer('min_price_paise'),

    /**
     * *Which* offer that price belongs to.
     *
     * Without it the storefront can show a price nobody can act on: adding to
     * a basket needs an offer id, and recomputing "cheapest" in the client
     * would be a second implementation of the §2.7.3 rule that could disagree
     * with the one that produced the number on screen.
     */
    bestOfferId: uuid('best_offer_id'),
    bestBranchId: uuid('best_branch_id'),
    mrpPaise: integer('mrp_paise'),
    /** The §2.7.3 rule: an unavailable product never outranks an available one. */
    isAvailable: boolean('is_available').notNull().default(false),
    offerCount: integer('offer_count').notNull().default(0),
    /** Branches on QUANTITY mode get a ranking bonus — the §1.9.2 incentive. */
    quantityModeOfferCount: integer('quantity_mode_offer_count').notNull().default(0),

    /**
     * Free text for matching: name, brand, category and translations.
     *
     * Indexed with the `simple` configuration, not `english`. English stemming
     * mangles transliterated Hindi — it would strip "s" from "rasgullas" but
     * also rewrite "besan" and "poha" unpredictably. Stemming is a decision for
     * the synonym table, where a human makes it.
     */
    searchText: text('search_text').notNull(),

    indexedAt: timestamp('indexed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // The hot path: available products first, then cheapest.
    index('product_index_available_idx').on(table.isAvailable, table.minPricePaise),
    index('product_index_category_idx').on(table.categoryId, table.isAvailable),
    index('product_index_status_idx').on(table.productStatus),
  ],
);

export type SynonymRow = typeof synonym.$inferSelect;
export type ProductIndexRow = typeof productIndex.$inferSelect;
export type NewProductIndexRow = typeof productIndex.$inferInsert;
