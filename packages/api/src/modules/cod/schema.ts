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
 * Tables owned by the cod module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const codSchema = pgSchema('cod');

/**
 * The knobs ops turn, in the database rather than the environment (§2.10.4).
 *
 * §2.10.4 requires thresholds be changeable **without a deploy**, and on Cloud
 * Run an environment variable is not: changing one creates a revision, which is
 * a deploy with a different name. A row is a row — an operator edits it at 11pm
 * during a bad week and the next order is scored by the new numbers.
 *
 * One row per environment, keyed by a constant, because "the current
 * thresholds" is a single fact and a table that can hold two of them will
 * eventually hold two of them.
 */
export const codConfig = codSchema.table('cod_config', {
  /** Always 'default'. A primary key that admits exactly one row. */
  key: text('key').primaryKey().default('default'),

  thresholds: jsonb('thresholds').notNull(),

  /** Who last changed it. Required by §2.10.4's audit obligation. */
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every risk decision, kept (§2.10.4, §3.8).
 *
 * Written for every COD order including the ones that sail through, not only
 * the refused ones. A log of refusals answers "why was I blocked?" but not "are
 * the thresholds right?", and the second question is the one that decides
 * whether COD is profitable.
 *
 * The thresholds are **snapshotted into the row**. They change without a
 * deploy, so a decision read six weeks later cannot be explained by the config
 * as it stands today — and "why was this order blocked?" is exactly the
 * question asked long after the fact.
 */
export const codRiskDecision = codSchema.table(
  'cod_risk_decision',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by the order module. Validated through contracts, never joined. */
    orderId: uuid('order_id'),
    accountId: uuid('account_id').notNull(),

    band: text('band').notNull(),
    score: integer('score').notNull(),
    /** Every rule that fired. "The model said so" is not an explanation. */
    reasons: jsonb('reasons').notNull(),

    /** What the rules were at the moment of the decision. */
    thresholds: jsonb('thresholds').notNull(),
    /** What the decision was made about, so a score can be recomputed. */
    inputs: jsonb('inputs').notNull(),

    /** NONE, QUICK_REPLY or OTP — what this decision demanded. */
    confirmationMethod: text('confirmation_method').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cod_decision_order_idx').on(table.orderId),
    index('cod_decision_account_idx').on(table.accountId),
    // The band distribution over time is the report that says whether a
    // threshold change did what it was meant to.
    index('cod_decision_band_idx').on(table.band, table.createdAt),
  ],
);

/**
 * One confirmation ceremony (§2.10.4).
 *
 * Separate from the decision because a decision is a fact and a confirmation is
 * a conversation: it has a window, attempts, and an outcome that arrives
 * minutes later from a different direction entirely.
 *
 * The OTP is stored as a **hash**. It is six digits guarding a grocery
 * delivery rather than a bank balance, but a support person reading a live code
 * out of a table is the beginning of a story that ends badly, and hashing costs
 * nothing here.
 */
export const codConfirmation = codSchema.table(
  'cod_confirmation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    orderId: uuid('order_id').notNull(),
    accountId: uuid('account_id').notNull(),

    method: text('method').notNull(),
    status: text('status').notNull(),

    /** SHA-256 of the code. Null for a quick-reply confirmation. */
    otpHash: text('otp_hash'),
    attempts: integer('attempts').notNull().default(0),

    /** After this, the order is cancelled and its stock released. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    /**
     * Who resolved it. Null when the customer did it themselves, set when an
     * operator overrode — which is the whole point of recording it.
     */
    resolvedBy: uuid('resolved_by'),
    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One live ceremony per order. Two confirmations for one order means two
    // codes in flight and a customer reading the wrong one.
    uniqueIndex('cod_confirmation_order_key').on(table.orderId),
    index('cod_confirmation_status_idx').on(table.status, table.expiresAt),
  ],
);
