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
 * Tables owned by the analytics module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const analyticsSchema = pgSchema('analytics');

/**
 * Raw event landing table (spec §5.3).
 *
 * Events land here first and are shipped to the warehouse from here, so a
 * warehouse outage costs latency rather than data. Nothing in the order path
 * reads this table — analytics is a separate read path precisely so reporting
 * never contends with transactional load (§5.3).
 */
export const event = analyticsSchema.table(
  'event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Client-supplied, unique per event: makes at-least-once delivery safe. */
    eventId: text('event_id').notNull(),

    /** A name from the contracts catalogue. Unknown names are rejected at ingest. */
    name: text('name').notNull(),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Null when anonymous; `anonId` still stitches the funnel together. */
    accountId: uuid('account_id'),
    anonId: text('anon_id').notNull(),
    sessionId: text('session_id').notNull(),

    platform: text('platform').notNull(),
    appVersion: text('app_version'),
    city: text('city'),

    experimentVariants: jsonb('experiment_variants').notNull().default({}),

    /** Screened against FORBIDDEN_PROPERTY_KEYS at ingest (§5.3). */
    properties: jsonb('properties').notNull().default({}),

    correlationId: text('correlation_id'),
  },
  (table) => [
    // MUST be unique: `onConflictDoNothing()` has nothing to conflict *with*
    // otherwise, so retried deliveries would be stored twice and inflate every
    // funnel count. A plain index here silently broke dedupe until the e2e
    // test caught it.
    uniqueIndex('event_dedupe_idx').on(table.eventId),
    // The funnel query shape: one event over a time window.
    index('event_name_time_idx').on(table.name, table.occurredAt),
    index('event_account_idx').on(table.accountId, table.occurredAt),
    index('event_session_idx').on(table.sessionId),
  ],
);

export type EventRow = typeof event.$inferSelect;
export type NewEventRow = typeof event.$inferInsert;
