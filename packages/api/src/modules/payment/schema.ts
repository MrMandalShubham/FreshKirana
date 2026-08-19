import { sql } from 'drizzle-orm';
import {
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
 * Tables owned by the payment module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const paymentSchema = pgSchema('payment');

/**
 * One attempt to take money for an order (spec §2.10).
 *
 * An attempt, not a payment — a customer whose UPI fails and who then pays
 * with a second app has two rows, and only one of them captured. Modelling it
 * as "the order's payment" would make that history unrepresentable, and §2.10.3
 * expects retries to be the normal case rather than an exception.
 */
export const payment = paymentSchema.table(
  'payment',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by the order module. Validated through contracts, never joined. */
    orderId: uuid('order_id').notNull(),
    accountId: uuid('account_id').notNull(),

    provider: text('provider').notNull(),
    /** The gateway's order handle — what the checkout SDK opens. */
    providerOrderId: text('provider_order_id'),
    /** The gateway's payment handle. Null until they actually pay. */
    providerPaymentId: text('provider_payment_id'),

    amountPaise: integer('amount_paise').notNull(),
    /** UPI_INTENT | UPI_COLLECT | CARD | … Null until the customer chooses. */
    method: text('method'),

    /** PENDING | AUTHORISED | CAPTURED | FAILED | REFUNDED … (§2.6.2) */
    status: text('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),

    /**
     * Rule R4. The gateway must not create two orders for one checkout: a
     * client that retries after a timeout would otherwise get a second payable
     * handle for an order that already has one.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /** After this the intent is dead and the stock hold expires with it. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('payment_idempotency_key').on(table.idempotencyKey),
    // Webhooks arrive knowing the gateway's handle and nothing of ours.
    uniqueIndex('payment_provider_order_key').on(table.provider, table.providerOrderId),

    index('payment_order_idx').on(table.orderId),
    // The reconciliation job's query: still pending, oldest first (§2.11.3).
    index('payment_pending_idx').on(table.status, table.createdAt),
  ],
);

/**
 * Every webhook the gateway sent us (§2.10.2).
 *
 * Written before it is acted on, and keyed by the provider's event id. Gateways
 * redeliver — that is documented behaviour — and applying "captured" twice is
 * how a customer is charged once and credited twice.
 *
 * It is also the evidence for a payment dispute: what arrived, when, and what
 * we did about it. A gateway's own dashboard is not a record we control.
 */
export const paymentEvent = paymentSchema.table(
  'payment_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    provider: text('provider').notNull(),
    /** The replay key. */
    providerEventId: text('provider_event_id').notNull(),
    providerPaymentId: text('provider_payment_id'),
    providerOrderId: text('provider_order_id'),

    /** Our payment row, once matched. Null when nothing matched. */
    paymentId: uuid('payment_id'),

    status: text('status').notNull(),
    /** Exactly what arrived, for when our reading of it turns out to be wrong. */
    raw: jsonb('raw').notNull().default({}),

    /** What we did about it. Null while unhandled. */
    outcome: text('outcome'),

    /**
     * How the event reached us.
     *
     * `WEBHOOK` or `RECONCILIATION` — §2.11.3 wants to know how often the
     * webhook path is failing, and a recovered payment that looks identical to
     * a delivered one hides exactly that.
     */
    source: text('source').notNull().default('WEBHOOK'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('payment_event_provider_key').on(table.provider, table.providerEventId),
    index('payment_event_payment_idx').on(table.paymentId),
  ],
);

export type PaymentRow = typeof payment.$inferSelect;
export type PaymentEventRow = typeof paymentEvent.$inferSelect;
