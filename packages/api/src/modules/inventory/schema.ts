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
 * Tables owned by the inventory module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const inventorySchema = pgSchema('inventory');

/**
 * A hold on stock (spec §2.5).
 *
 * ## Why this table exists separately from the counter
 *
 * `vendor_offer.stock_reserved` is a number. It says *how much* is held and
 * nothing about *why*, so a counter that drifts — and counters drift — cannot
 * be reconciled against anything. These rows are the ledger behind it: every
 * unit held is one row, attributable to an order, with a time it was taken.
 *
 * ## Held at checkout, not at add-to-cart
 *
 * §2.5 is explicit, and the reason is worth keeping: a cart hold means one
 * shopper who is browsing makes an item appear out of stock to everyone else.
 * It is the most common way to get this wrong.
 */
export const reservation = inventorySchema.table(
  'reservation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by offer. Validated through its contracts, never joined. */
    vendorOfferId: uuid('vendor_offer_id').notNull(),
    /** Null while a checkout is in flight and no order exists yet. */
    orderId: uuid('order_id'),
    accountId: uuid('account_id'),

    quantity: integer('quantity').notNull(),

    /** HELD | CONFIRMED | CONSUMED | RELEASED */
    status: text('status').notNull().default('HELD'),

    /**
     * Rule R4. Every reserve, confirm and release carries a key, and a retry
     * with the same key must not decrement twice.
     *
     * A network timeout during checkout is indistinguishable from a failure to
     * the client, so clients retry — and without this, the retry takes a second
     * unit of a five-unit shelf.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /**
     * When an unconfirmed hold lapses. Null once confirmed.
     *
     * Nulled rather than left in the past, so the sweeper's query needs no
     * knowledge of status precedence: anything with an expiry that has passed
     * is expired, full stop.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /** Why it ended, for the reconciliation nobody wants to do by hand. */
    releasedReason: text('released_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // The idempotency guarantee, enforced by the database rather than by a
    // check-then-insert that two concurrent retries would both pass.
    uniqueIndex('reservation_idempotency_key').on(table.idempotencyKey),

    index('reservation_offer_idx').on(table.vendorOfferId, table.status),
    index('reservation_order_idx').on(table.orderId),
    // The sweeper's query: expired holds, oldest first.
    index('reservation_expiry_idx').on(table.status, table.expiresAt),

    check('reservation_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

export type ReservationRow = typeof reservation.$inferSelect;
