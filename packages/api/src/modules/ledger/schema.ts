import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the ledger module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const ledgerSchema = pgSchema('ledger');

/**
 * An account money moves between (spec §2.4.4).
 *
 * Created on first use rather than seeded, because the scoped accounts are one
 * per customer, supplier, location or driver — and none of those lists is known
 * at migration time. See `ACCOUNT_SCOPE` in contracts for which is which.
 */
export const ledgerAccount = ledgerSchema.table(
  'account',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** A `LedgerAccount` from contracts. Validated there, not by an enum here. */
    type: text('type').notNull(),

    /**
     * The customer, supplier, location or driver id for a scoped account, and
     * the empty string otherwise.
     *
     * Empty string rather than null so the unique index below actually works:
     * in Postgres `null` is never equal to `null`, so a nullable column would
     * happily admit a second, third and fourth SALES_REVENUE account.
     */
    scopeId: text('scope_id').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ledger_account_unique').on(table.type, table.scopeId)],
);

/**
 * One side of one journal entry (spec §2.4.4).
 *
 * Rows are never updated and never deleted. A correction is a new entry that
 * reverses the old one, because a ledger you can edit is a ledger that cannot
 * be audited — and "who changed this number" is the question that matters when
 * a customer disputes their balance.
 */
export const ledgerEntry = ledgerSchema.table(
  'entry',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Groups the postings that must balance.
     *
     * The balance invariant is *per transaction*, so this is the column the
     * constraint trigger groups by. Not a foreign key to anything — a journal
     * entry is defined by its postings, and a separate header table would be a
     * row that can exist with nothing under it.
     */
    txnId: uuid('txn_id').notNull(),

    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccount.id),

    /*
     * bigint, not integer.
     *
     * Money is integer paise, and `integer` tops out at about ₹21 crore. That
     * is a plausible lifetime turnover, and the failure mode is silent overflow
     * inside a sum — a ledger that stops balancing for a reason nobody finds.
     */
    debitPaise: bigint('debit_paise', { mode: 'number' }).notNull().default(0),
    creditPaise: bigint('credit_paise', { mode: 'number' }).notNull().default(0),

    /** What this was posted for: INVOICE, GRN, RECEIPT, TRANSFER … */
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id'),

    description: text('description'),

    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_entry_txn').on(table.txnId),
    index('ledger_entry_account').on(table.accountId, table.postedAt),
    index('ledger_entry_ref').on(table.refType, table.refId),

    // Negative amounts are a credit written the hard way: two representations
    // of one movement, and no way to trust a summed column.
    check('ledger_entry_not_negative', sql`debit_paise >= 0 and credit_paise >= 0`),

    // Exactly one side. A row that is both is unreadable; a row that is neither
    // balances perfectly and means nothing, which is worse.
    check('ledger_entry_one_side', sql`(debit_paise = 0) <> (credit_paise = 0)`),
  ],
);
