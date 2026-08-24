import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the cart module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const cartSchema = pgSchema('cart');

/**
 * A shopper's basket (spec §1.5.1, §4.2).
 *
 * ## Belongs to one branch
 *
 * Decision D2 fixes one order to one store, so a cart pins to a branch as soon
 * as the first item goes in. That is a genuine constraint on the experience —
 * a shopper cannot mix two shops in one basket — and it is enforced here rather
 * than discovered at checkout, where it would mean discarding their work.
 *
 * ## Works before signup
 *
 * Browsing precedes signup (§1.5.1), so a cart may belong to an anonymous
 * visitor identified by a token, and is merged into their account on sign-in.
 * Requiring a login to hold a basket loses the shopper at the top of the funnel.
 */
export const cart = cartSchema.table(
  'cart',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by identity. Null while the shopper is anonymous. */
    accountId: uuid('account_id'),
    /** Client-generated token for an anonymous basket. Null once claimed. */
    anonId: text('anon_id'),

    /** Set by the first line, cleared when the cart empties (D2). */
    branchId: uuid('branch_id'),

    /** AUTO_SUBSTITUTE | ASK_ME | REFUND_ITEM (§1.7.2). Chosen at checkout, defaulted here. */
    substitutionPreference: text('substitution_preference')
      .notNull()
      .default('AUTO_SUBSTITUTE'),

    /** ACTIVE | CONVERTED | ABANDONED */
    status: text('status').notNull().default('ACTIVE'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // One active cart per shopper, on either identity. Partial so converted and
    // abandoned carts accumulate freely for the §5.2 funnel.
    uniqueIndex('cart_active_account_key')
      .on(table.accountId)
      .where(sql`${table.status} = 'ACTIVE' and ${table.accountId} is not null`),
    uniqueIndex('cart_active_anon_key')
      .on(table.anonId)
      .where(sql`${table.status} = 'ACTIVE' and ${table.anonId} is not null`),

    index('cart_branch_idx').on(table.branchId),

    /**
     * A cart must be reachable by someone. A row with neither identity is
     * orphaned the moment it is written — nobody can ever load it, and it would
     * sit in the table forever looking like abandoned demand.
     */
    check(
      'cart_has_an_owner',
      sql`${table.accountId} is not null or ${table.anonId} is not null`,
    ),
  ],
);

/**
 * One product in the basket.
 *
 * `quantity` means packs for packaged goods and the product's own unit for
 * loose goods — see QuantityMode in contracts. `unitPricePaise` is the price
 * *when added*: it is kept to detect a change, never to charge by. Grocery
 * prices move daily, and honouring a stale snapshot would either short the
 * branch or overcharge the shopper.
 */
export const cartLine = cartSchema.table(
  'cart_line',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    cartId: uuid('cart_id')
      .notNull()
      .references(() => cart.id, { onDelete: 'cascade' }),

    /** Owned by the offer module. Validated through its contracts, never joined. */
    vendorOfferId: uuid('vendor_offer_id').notNull(),
    /** Owned by catalog. Denormalised so the cart can be read without a second hop. */
    masterProductId: uuid('master_product_id').notNull(),

    quantity: integer('quantity').notNull(),

    /** Snapshot for change detection only. Charging always uses the live price. */
    addedAtPricePaise: integer('added_at_price_paise').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Adding the same offer twice increases the quantity; it never creates a
    // second line, which would show the shopper the same product twice.
    uniqueIndex('cart_line_offer_key').on(table.cartId, table.vendorOfferId),
    index('cart_line_cart_idx').on(table.cartId),

    check('cart_line_quantity_positive', sql`${table.quantity} > 0`),
    check('cart_line_price_positive', sql`${table.addedAtPricePaise} > 0`),
  ],
);

export type CartRow = typeof cart.$inferSelect;
export type CartLineRow = typeof cartLine.$inferSelect;
