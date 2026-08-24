import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNT_NATURE,
  AccountNature,
  type LedgerAccount,
  type LedgerRef,
  type Posting,
  checkPostings,
  requiresScope,
} from '@freshkirana/contracts';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { ledgerAccount, ledgerEntry } from '../schema';

export interface PostResult {
  txnId: string;
  postings: number;
}

export interface AccountBalance {
  account: LedgerAccount;
  scopeId: string | null;
  /** Signed by the account's nature: positive means "more of what it is". */
  balancePaise: number;
  debitsPaise: number;
  creditsPaise: number;
}

export interface IntegrityReport {
  transactions: number;
  unbalanced: Array<{ txnId: string; differencePaise: number }>;
  totalDebitsPaise: number;
  totalCreditsPaise: number;
  ok: boolean;
}

/**
 * The ledger (spec §2.4.4, rule R5).
 *
 * Every financial event posts a balanced journal entry through `post`. There is
 * no other way in, and `post` refuses anything that does not balance.
 *
 * ## Three layers, deliberately
 *
 * 1. `checkPostings` in contracts — pure, gives a good error message.
 * 2. This service — refuses before touching the database.
 * 3. A deferred constraint trigger in Postgres — checks at COMMIT.
 *
 * Only the third is a guarantee. The first two can be bypassed by a future code
 * path that writes rows directly; the trigger cannot. Readiness item G5 is
 * explicit that a ledger which can go unbalanced *silently* is worse than no
 * ledger, because the wrong numbers get trusted.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes one balanced journal entry.
   *
   * All postings land in a single transaction. A partially written entry would
   * be an unbalanced ledger, which is the one state this must never reach.
   */
  async post(input: {
    postings: readonly Posting[];
    refType: LedgerRef;
    refId?: string | null;
    description?: string;
    /** Supply to make a posting idempotent — replaying an event is normal. */
    txnId?: string;
  }): Promise<PostResult> {
    const check = checkPostings(input.postings);
    if (!check.ok) {
      throw new BadRequestException({
        message: 'Journal entry refused',
        code: check.error,
        ...(check.differencePaise !== undefined
          ? { differencePaise: check.differencePaise }
          : {}),
        // Which account, and what it wanted. A scope error that only says
        // "missing scope" leaves the caller to guess which of five postings
        // was wrong and whether it wanted a customer, a location or a driver.
        ...(check.account !== undefined ? { account: check.account } : {}),
        ...(check.expectedScope !== undefined
          ? { expectedScope: check.expectedScope }
          : {}),
      });
    }

    const txnId = input.txnId ?? randomUUID();

    return this.db.transaction(async (tx) => {
      /*
       * Idempotency.
       *
       * Payment webhooks and job retries arrive more than once by design
       * (§2.10), so posting the same event twice has to be a no-op rather than
       * double a customer's receivable — money somebody is then asked to pay
       * twice. Checked inside the transaction so two concurrent replays cannot
       * both find nothing.
       */
      const existing = await tx
        .select({ id: ledgerEntry.id })
        .from(ledgerEntry)
        .where(eq(ledgerEntry.txnId, txnId))
        .limit(1);

      if (existing.length > 0) {
        return { txnId, postings: 0 };
      }

      const rows = [];
      for (const posting of input.postings) {
        const accountId = await this.accountIdFor(
          tx,
          posting.account,
          posting.scopeId ?? null,
        );

        rows.push({
          txnId,
          accountId,
          debitPaise: Number(posting.debitPaise),
          creditPaise: Number(posting.creditPaise),
          refType: input.refType,
          refId: input.refId ?? null,
          description: posting.description ?? input.description ?? null,
        });
      }

      await tx.insert(ledgerEntry).values(rows);

      return { txnId, postings: rows.length };
    });
  }

  /**
   * Finds or creates an account.
   *
   * `on conflict do nothing` then re-select, rather than checking first: two
   * concurrent invoices for the same new customer would both find nothing and
   * both insert, and the unique index would fail one of them.
   */
  private async accountIdFor(
    tx: Transaction,
    account: LedgerAccount,
    scopeId: string | null,
  ): Promise<string> {
    // Empty string, not null — see the column comment in schema.ts.
    const scope = requiresScope(account) ? (scopeId ?? '') : '';

    await tx
      .insert(ledgerAccount)
      .values({ type: account, scopeId: scope })
      .onConflictDoNothing();

    const [row] = await tx
      .select({ id: ledgerAccount.id })
      .from(ledgerAccount)
      .where(and(eq(ledgerAccount.type, account), eq(ledgerAccount.scopeId, scope)))
      .limit(1);

    if (!row) {
      // Unreachable unless the insert above was rolled back underneath us.
      throw new Error(`Ledger account ${account}/${scope} could not be resolved`);
    }

    return row.id;
  }

  /**
   * What an account holds.
   *
   * Signed by nature, so a positive `CUSTOMER_RECEIVABLE` means money owed to
   * us rather than a number whose direction the caller has to remember.
   */
  async balance(
    account: LedgerAccount,
    scopeId?: string | null,
  ): Promise<AccountBalance> {
    const scope = requiresScope(account) ? (scopeId ?? '') : '';

    const [row] = await this.db
      .select({
        debits: sql<number>`coalesce(sum(${ledgerEntry.debitPaise}), 0)::bigint`,
        credits: sql<number>`coalesce(sum(${ledgerEntry.creditPaise}), 0)::bigint`,
      })
      .from(ledgerEntry)
      .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerEntry.accountId))
      .where(and(eq(ledgerAccount.type, account), eq(ledgerAccount.scopeId, scope)));

    const debits = Number(row?.debits ?? 0);
    const credits = Number(row?.credits ?? 0);
    const nature = ACCOUNT_NATURE[account];
    const risesOnDebit =
      nature === AccountNature.ASSET || nature === AccountNature.EXPENSE;

    return {
      account,
      scopeId: scope === '' ? null : scope,
      debitsPaise: debits,
      creditsPaise: credits,
      balancePaise: risesOnDebit ? debits - credits : credits - debits,
    };
  }

  /**
   * The nightly integrity check (§2.4.4, readiness G5).
   *
   * Two questions: does every individual transaction balance, and does the
   * ledger balance overall. The second can pass while the first fails — two
   * transactions wrong by equal and opposite amounts — which is exactly the
   * kind of error a single total would hide.
   */
  async checkIntegrity(): Promise<IntegrityReport> {
    // The query builder rather than raw `execute`: `execute` hands back a
    // driver QueryResult whose shape differs between drivers, and reading it
    // wrongly is how this returned something that was not an array.
    const unbalanced = await this.db
      .select({
        txnId: ledgerEntry.txnId,
        difference: sql<number>`sum(${ledgerEntry.debitPaise}) - sum(${ledgerEntry.creditPaise})`,
      })
      .from(ledgerEntry)
      .groupBy(ledgerEntry.txnId)
      .having(sql`sum(${ledgerEntry.debitPaise}) <> sum(${ledgerEntry.creditPaise})`)
      .limit(100);

    const [totals] = await this.db
      .select({
        transactions: sql<number>`count(distinct ${ledgerEntry.txnId})::int`,
        debits: sql<number>`coalesce(sum(${ledgerEntry.debitPaise}), 0)::bigint`,
        credits: sql<number>`coalesce(sum(${ledgerEntry.creditPaise}), 0)::bigint`,
      })
      .from(ledgerEntry);

    const report: IntegrityReport = {
      transactions: Number(totals?.transactions ?? 0),
      unbalanced: unbalanced.map((row) => ({
        txnId: row.txnId,
        differencePaise: Number(row.difference),
      })),
      totalDebitsPaise: Number(totals?.debits ?? 0),
      totalCreditsPaise: Number(totals?.credits ?? 0),
      ok: unbalanced.length === 0,
    };

    if (!report.ok) {
      // Loud, because the trigger should have made this impossible. If it ever
      // fires, something wrote rows around the constraint.
      this.logger.error(
        `LEDGER OUT OF BALANCE: ${report.unbalanced.length} transaction(s) do not balance`,
      );
    }

    return report;
  }
}
