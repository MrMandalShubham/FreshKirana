import { sql } from 'drizzle-orm';
import { index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Tables owned by the identity module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const identitySchema = pgSchema('identity');

/**
 * An authenticatable principal.
 *
 * Deliberately thin: it holds only what authentication needs. Customer
 * profiles, addresses and consent live in the `user` module; branch details
 * live in `branch` (§2.2).
 *
 * Credentials are absent by design — P0.3a has no authentication ceremony.
 * OTP secrets, refresh-token families and sessions arrive with P8.6.
 */
export const account = identitySchema.table(
  'account',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** E.164, e.g. +919000000001. The login identifier from P8.6 onward. */
    phone: text('phone').notNull(),

    displayName: text('display_name').notNull(),

    /** active | suspended | deleted */
    status: text('status').notNull().default('active'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex('account_phone_key').on(table.phone)],
);

/**
 * A role held by an account, bounded by a scope (§3.2).
 *
 * The scope is what makes authorisation resource-level rather than merely
 * role-level: VENDOR_STAFF is not an authority over all stores, it is an
 * authority over one. Checking the role without the scope is the bug that
 * leaks one branch's orders to another.
 */
export const accountRole = identitySchema.table(
  'account_role',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),

    /** One of contracts' `Role`. */
    role: text('role').notNull(),

    /** GLOBAL | VENDOR */
    scopeType: text('scope_type').notNull(),

    /**
     * Branch id for VENDOR-scoped roles, null for GLOBAL.
     * Not a foreign key yet — the branch table arrives in P1.2.
     */
    scopeId: uuid('scope_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('account_role_account_idx').on(table.accountId),
    index('account_role_scope_idx').on(table.scopeType, table.scopeId),
    // One row per (account, role, scope): holding VENDOR_STAFF twice at the
    // same store is meaningless and would duplicate authorisation checks.
    //
    // COALESCE rather than a plain unique index because PostgreSQL treats NULLs
    // as distinct by default, which would let a GLOBAL role (scope_id IS NULL)
    // be granted to the same account repeatedly.
    uniqueIndex('account_role_unique').on(
      table.accountId,
      table.role,
      sql`coalesce(${table.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

export type AccountRow = typeof account.$inferSelect;
export type NewAccountRow = typeof account.$inferInsert;
export type AccountRoleRow = typeof accountRole.$inferSelect;
export type NewAccountRoleRow = typeof accountRole.$inferInsert;
