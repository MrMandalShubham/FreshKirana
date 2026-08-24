import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the notification module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const notificationSchema = pgSchema('notification');

/**
 * Every message we sent, and what became of it (spec §2.12).
 *
 * §2.12 calls for a delivery-receipt log "for dispute evidence", and that is
 * exactly what this is for. When a store says "I never got the order" the only
 * useful answer is a row showing what was sent, to which number, at what time,
 * and whether the provider reported it delivered or read. Without it the
 * argument is unwinnable and the branch is right by default.
 *
 * It is also the mock channel's outbox: in development the message is written
 * here and nowhere else, which is what makes the flow testable without a BSP.
 */
export const message = notificationSchema.table(
  'message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    channel: text('channel').notNull(),
    template: text('template').notNull(),

    /** E.164. The number the provider was asked to deliver to. */
    toPhone: text('to_phone').notNull(),

    /** Who this was for. All optional — a message may concern none of them. */
    accountId: uuid('account_id'),
    branchId: uuid('branch_id'),
    orderId: uuid('order_id'),

    /** The template variables, as sent. Rendered text is derived, never stored twice. */
    payload: jsonb('payload').notNull().default({}),

    /** QUEUED | SENT | DELIVERED | READ | FAILED */
    status: text('status').notNull().default('QUEUED'),
    /** The provider's id, for matching its delivery receipts back to this row. */
    providerMessageId: text('provider_message_id'),
    failureReason: text('failure_reason'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** In-app only: when the customer opened it. Null while unread. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('message_order_idx').on(table.orderId, table.template),
    index('message_branch_idx').on(table.branchId, table.createdAt),
    index('message_provider_idx').on(table.providerMessageId),
    // The in-app inbox reads by account, newest first.
    index('message_account_idx').on(table.accountId, table.createdAt),
  ],
);

/**
 * Every reply we received.
 *
 * Stored before it is acted on, and keyed by the provider's message id so a
 * redelivered webhook cannot accept the same order twice. Providers retry —
 * that is not an edge case, it is the documented behaviour of every messaging
 * API — and "accept" applied twice would look harmless right up until the
 * button is "cancel".
 */
export const inboundMessage = notificationSchema.table(
  'inbound_message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    channel: text('channel').notNull(),

    /** The provider's id for this inbound message. The idempotency key. */
    providerMessageId: text('provider_message_id').notNull(),

    fromPhone: text('from_phone').notNull(),
    /** The parsed quick reply, or null when somebody typed something. */
    reply: text('reply'),
    /** Exactly what arrived, for when the parse turns out to be wrong. */
    raw: jsonb('raw').notNull().default({}),

    /** The message being replied to, when the provider tells us. */
    inReplyToMessageId: uuid('in_reply_to_message_id'),
    orderId: uuid('order_id'),

    /** What we did about it. Null while unhandled. */
    outcome: text('outcome'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // The idempotency key. A retried webhook finds this row and stops.
    uniqueIndex('inbound_message_provider_key').on(
      table.channel,
      table.providerMessageId,
    ),
    index('inbound_message_order_idx').on(table.orderId),
  ],
);

export type MessageRow = typeof message.$inferSelect;
export type InboundMessageRow = typeof inboundMessage.$inferSelect;
