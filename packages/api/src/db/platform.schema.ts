import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Cross-cutting infrastructure, not a bounded context.
 *
 * Lives outside `src/modules/` deliberately: it is owned by the platform rather
 * than any domain, so the schema-ownership check does not apply to it.
 */
export const platformSchema = pgSchema('platform');

/**
 * Transactional outbox (spec §2.13).
 *
 * Domain events are written in the *same transaction* as the state change that
 * produced them, then relayed by a worker. This gives at-least-once delivery
 * without distributed transactions — the reason §2.3 could drop Kafka.
 *
 * Consumers must therefore be idempotent.
 */
export const outbox = platformSchema.table(
  'outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Aggregate that produced the event, e.g. `order`. */
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),

    /** Versioned event name from `contracts/events/`, e.g. `order.placed.v1`. */
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Null until the relay has published it. */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [
    // The relay's hot query: unpublished events, oldest first.
    index('outbox_unpublished_idx')
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
    index('outbox_aggregate_idx').on(table.aggregateType, table.aggregateId),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;
