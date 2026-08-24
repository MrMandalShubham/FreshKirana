/**
 * Double-entry bookkeeping for a distribution business (spec §2.4.4, rule R5).
 *
 * Every purchase, sale, stock movement, wastage, receipt, refund and cash
 * movement posts a **balanced journal entry**: the debits and the credits of
 * one transaction sum to the same number, always.
 *
 * The point of the discipline is that **the numbers that run the business are
 * computed from the ledger, never summed from order rows**. Summing orders
 * looks identical right up until a credit note is counted twice or a cancelled
 * order is counted at all, and then a customer's balance is wrong and nobody
 * can say why. A ledger that balances can be reasoned about; a sum cannot.
 *
 * A ledger that can go unbalanced silently is worse than no ledger, because you
 * will trust the wrong numbers (readiness item G5). So an unbalanced entry is
 * refused here, refused again by the service, and refused a third time by a
 * deferred constraint trigger in the database — the only one of the three that
 * no code path can go around.
 *
 * ## Why this file was re-cut
 *
 * The first version of this chart was written for a **marketplace**: it had
 * `VENDOR_PAYABLE` for money owed to third-party shops, `PLATFORM_REVENUE` for
 * commission earned on goods we never touched, and the GST §52 / 194-O accounts
 * that apply to an e-commerce *operator*.
 *
 * FreshKirana buys, owns and sells its own stock. So the money moves the other
 * way round: **customers owe us** (`CUSTOMER_RECEIVABLE`), **we owe suppliers**
 * (`SUPPLIER_PAYABLE`), revenue is the sale itself rather than a cut of someone
 * else's, and there is a cost of goods to set against it. The marketplace tax
 * accounts do not apply to a principal supplier at all.
 *
 * The invariants below are unchanged. Only the accounts moved.
 */

import type { Paise } from './money';

/**
 * The accounts money moves between.
 *
 * Deliberately a closed union. An account invented at runtime is money landing
 * somewhere nobody reconciles, which is exactly the failure this exists to
 * prevent.
 */
export const LedgerAccount = {
  // ---------------------------------------------------------------- assets
  /** Stock we own, carried at landed cost. One balance per location. */
  INVENTORY: 'INVENTORY',
  /**
   * Stock that has left one location and not yet arrived at another.
   *
   * A real state, not a rounding detail: it belongs to neither end, and it must
   * be sellable from neither. Without it the same crate is counted twice — once
   * as still at the hub and once as already at the branch — or vanishes for the
   * days it spends on a truck.
   */
  INVENTORY_IN_TRANSIT: 'INVENTORY_IN_TRANSIT',
  /**
   * What customers owe us. One balance per customer.
   *
   * The credit book, and the single most important account in the business.
   * A balance older than its due date **is** the overdue amount — computed,
   * never asserted, and never kept in a notebook.
   */
  CUSTOMER_RECEIVABLE: 'CUSTOMER_RECEIVABLE',
  /** Notes and coins at a branch or the hub, not yet banked. Per location. */
  CASH_IN_HAND: 'CASH_IN_HAND',
  /**
   * Cash a driver has collected and not yet handed over. Per driver.
   *
   * A non-zero balance after the deposit deadline **is** the shortfall, and it
   * is attributable to one person. That is the whole reason this is scoped.
   */
  CASH_IN_TRANSIT: 'CASH_IN_TRANSIT',
  /** Captured by the payment gateway, not yet settled to our bank. */
  GATEWAY_RECEIVABLE: 'GATEWAY_RECEIVABLE',
  /** Settled into the bank account. */
  BANK: 'BANK',
  /**
   * GST paid on purchases, freight and expenses, recoverable against output.
   *
   * An asset rather than a cost: it is money the business gets back. Treating
   * it as cost is a classic way to understate margin on every single purchase.
   */
  GST_INPUT_CREDIT: 'GST_INPUT_CREDIT',

  // ----------------------------------------------------------- liabilities
  /** What we owe suppliers for goods bought. One balance per supplier. */
  SUPPLIER_PAYABLE: 'SUPPLIER_PAYABLE',
  /** Owed back to a customer in cash, until the refund actually settles. */
  CUSTOMER_REFUND_PAYABLE: 'CUSTOMER_REFUND_PAYABLE',
  /** GST charged on sales, owed to the government. */
  GST_OUTPUT_PAYABLE: 'GST_OUTPUT_PAYABLE',

  // --------------------------------------------------------------- revenue
  /** Goods sold, at invoice value excluding tax. */
  SALES_REVENUE: 'SALES_REVENUE',
  /** Delivery and packing recovered, supplier schemes, everything else. */
  OTHER_INCOME: 'OTHER_INCOME',

  // -------------------------------------------------------------- expenses
  /**
   * The landed cost of what was actually shipped.
   *
   * Posted against `SALES_REVENUE` on the same invoice, so **gross margin falls
   * out of the ledger** rather than being reconstructed later from a purchase
   * file and a sales file that never quite agree.
   */
  COGS: 'COGS',
  /**
   * Stock destroyed — damage, expiry, shrinkage.
   *
   * Separate from `WRITE_OFF` on purpose. This is goods that no longer exist;
   * that is a debt forgiven. They have different owners, different controls and
   * different remedies, and pooling them hides the one that is fixable.
   */
  WASTAGE: 'WASTAGE',
  /** Debt forgiven: bad debt, goodwill, a shortfall nobody can recover. */
  WRITE_OFF: 'WRITE_OFF',
} as const;

export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

export const LEDGER_ACCOUNTS = Object.values(LedgerAccount);

export function isLedgerAccount(value: string): value is LedgerAccount {
  return (LEDGER_ACCOUNTS as readonly string[]).includes(value);
}

/**
 * Which side of an account increases it.
 *
 * Assets and expenses rise on the debit side; liabilities and revenue rise on
 * the credit side. This is not decoration — it is what makes a balance readable
 * without having to remember which way round each account runs.
 */
export const AccountNature = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
} as const;

export type AccountNature = (typeof AccountNature)[keyof typeof AccountNature];

export const ACCOUNT_NATURE: Record<LedgerAccount, AccountNature> = {
  INVENTORY: AccountNature.ASSET,
  INVENTORY_IN_TRANSIT: AccountNature.ASSET,
  CUSTOMER_RECEIVABLE: AccountNature.ASSET,
  CASH_IN_HAND: AccountNature.ASSET,
  CASH_IN_TRANSIT: AccountNature.ASSET,
  GATEWAY_RECEIVABLE: AccountNature.ASSET,
  BANK: AccountNature.ASSET,
  GST_INPUT_CREDIT: AccountNature.ASSET,

  SUPPLIER_PAYABLE: AccountNature.LIABILITY,
  CUSTOMER_REFUND_PAYABLE: AccountNature.LIABILITY,
  GST_OUTPUT_PAYABLE: AccountNature.LIABILITY,

  SALES_REVENUE: AccountNature.REVENUE,
  OTHER_INCOME: AccountNature.REVENUE,

  COGS: AccountNature.EXPENSE,
  WASTAGE: AccountNature.EXPENSE,
  WRITE_OFF: AccountNature.EXPENSE,
};

/**
 * What a scoped account's `scopeId` refers to.
 *
 * Six accounts are scoped, and they are scoped by four *different kinds of
 * thing*. A flat "these ones need an id" list would happily accept a customer
 * id on an inventory account and produce a stock balance filed under a person.
 *
 * Naming the kind does not make that impossible — both are strings at runtime —
 * but it makes the chart self-describing, gives the error message something
 * useful to say, and leaves one obvious place to add real validation once the
 * owning modules exist.
 */
export const ScopeKind = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
  /** A branch or the hub. Both are locations; the hub is just the big one. */
  LOCATION: 'LOCATION',
  DRIVER: 'DRIVER',
} as const;

export type ScopeKind = (typeof ScopeKind)[keyof typeof ScopeKind];

/**
 * The scope each account is kept per, or `null` for one pooled balance.
 *
 * "What does Sharma General Store owe us?" is unanswerable from a single pooled
 * receivable, and pooling driver cash makes a shortfall impossible to pin on
 * anybody. Equally, scoping revenue per customer would silently create parallel
 * revenue accounts that nobody totals — so scope is granted deliberately, not
 * by default.
 */
export const ACCOUNT_SCOPE: Record<LedgerAccount, ScopeKind | null> = {
  INVENTORY: ScopeKind.LOCATION,
  /** Scoped to where the stock is *going*, so a branch can see what is coming. */
  INVENTORY_IN_TRANSIT: ScopeKind.LOCATION,
  CUSTOMER_RECEIVABLE: ScopeKind.CUSTOMER,
  CASH_IN_HAND: ScopeKind.LOCATION,
  CASH_IN_TRANSIT: ScopeKind.DRIVER,
  SUPPLIER_PAYABLE: ScopeKind.SUPPLIER,
  CUSTOMER_REFUND_PAYABLE: ScopeKind.CUSTOMER,

  GATEWAY_RECEIVABLE: null,
  BANK: null,
  GST_INPUT_CREDIT: null,
  GST_OUTPUT_PAYABLE: null,
  SALES_REVENUE: null,
  OTHER_INCOME: null,
  COGS: null,
  WASTAGE: null,
  WRITE_OFF: null,
};

/** Accounts that exist once per customer, supplier, location or driver. */
export const SCOPED_ACCOUNTS: readonly LedgerAccount[] = LEDGER_ACCOUNTS.filter(
  (account) => ACCOUNT_SCOPE[account] !== null,
);

export function requiresScope(account: LedgerAccount): boolean {
  return ACCOUNT_SCOPE[account] !== null;
}

/** What a scoped account is keyed by, for error messages and future checks. */
export function scopeKindFor(account: LedgerAccount): ScopeKind | null {
  return ACCOUNT_SCOPE[account];
}

/**
 * What a journal entry was posted for, so a number can be traced back.
 *
 * The financial event in a distribution business is the **invoice**, not the
 * order: an order is a promise, and promises do not move money. Goods receipt
 * is likewise the moment a purchase becomes a cost, which is why `GRN` is here
 * and separate from `PURCHASE`.
 */
export const LedgerRef = {
  /** A sale invoiced to a customer. Posts revenue, receivable, tax and COGS. */
  INVOICE: 'INVOICE',
  /** A customer payment, applied against specific invoices. */
  RECEIPT: 'RECEIPT',
  /** Gateway movement: capture, settlement, chargeback. */
  PAYMENT: 'PAYMENT',
  /** Cash returned to a customer. */
  REFUND: 'REFUND',
  /** Returns, rate differences, damages — a GST document in its own right. */
  CREDIT_NOTE: 'CREDIT_NOTE',
  /** A purchase order raised on a supplier. */
  PURCHASE: 'PURCHASE',
  /** Goods received. Where landed cost is fixed and inventory is created. */
  GRN: 'GRN',
  /** Money paid to a supplier. */
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  /** Stock moving between our own locations. */
  TRANSFER: 'TRANSFER',
  /** Damage, expiry, shrinkage — posted daily, not discovered at year end. */
  WASTAGE: 'WASTAGE',
  /** A physical count variance, reconciled to the ledger. */
  STOCK_COUNT: 'STOCK_COUNT',
  /** Cash banked by a driver or a branch. */
  CASH_DEPOSIT: 'CASH_DEPOSIT',
  /** A correction, posted by whoever owns the mistake. */
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type LedgerRef = (typeof LedgerRef)[keyof typeof LedgerRef];

/** One side of a journal entry. Exactly one of debit or credit is non-zero. */
export interface Posting {
  account: LedgerAccount;
  /** The customer, supplier, location or driver id for a scoped account. */
  scopeId?: string | null;
  debitPaise: Paise;
  creditPaise: Paise;
  description?: string;
}

export const LedgerError = {
  UNBALANCED: 'LEDGER_UNBALANCED',
  EMPTY: 'LEDGER_EMPTY',
  BOTH_SIDES: 'LEDGER_BOTH_SIDES',
  NEGATIVE: 'LEDGER_NEGATIVE',
  MISSING_SCOPE: 'LEDGER_MISSING_SCOPE',
  UNEXPECTED_SCOPE: 'LEDGER_UNEXPECTED_SCOPE',
} as const;

export type LedgerError = (typeof LedgerError)[keyof typeof LedgerError];

export interface LedgerCheck {
  ok: boolean;
  error?: LedgerError;
  /** Present on UNBALANCED, because "by how much" is the first question. */
  differencePaise?: number;
  /** Present on a scope error, so the message can name what was expected. */
  expectedScope?: ScopeKind;
  /** Present on a scope error, so the message can name the offending account. */
  account?: LedgerAccount;
}

/**
 * Whether a set of postings may be written.
 *
 * Pure, so the rule is testable without a database and identical wherever it
 * runs. The database enforces the same invariant independently — this is the
 * copy that produces a good error message, not the copy that guarantees it.
 */
export function checkPostings(postings: readonly Posting[]): LedgerCheck {
  if (postings.length === 0) return { ok: false, error: LedgerError.EMPTY };

  let debits = 0;
  let credits = 0;

  for (const posting of postings) {
    const debit = Number(posting.debitPaise);
    const credit = Number(posting.creditPaise);

    if (debit < 0 || credit < 0) {
      return { ok: false, error: LedgerError.NEGATIVE, account: posting.account };
    }

    // A posting that is both, or neither, is a posting nobody can read back.
    if ((debit === 0) === (credit === 0)) {
      return { ok: false, error: LedgerError.BOTH_SIDES, account: posting.account };
    }

    const scope = ACCOUNT_SCOPE[posting.account];
    if (scope !== null && !posting.scopeId) {
      return {
        ok: false,
        error: LedgerError.MISSING_SCOPE,
        account: posting.account,
        expectedScope: scope,
      };
    }
    if (scope === null && posting.scopeId) {
      return {
        ok: false,
        error: LedgerError.UNEXPECTED_SCOPE,
        account: posting.account,
      };
    }

    debits += debit;
    credits += credit;
  }

  if (debits !== credits) {
    return {
      ok: false,
      error: LedgerError.UNBALANCED,
      differencePaise: debits - credits,
    };
  }

  return { ok: true };
}

/**
 * The signed effect of a posting on its account's balance.
 *
 * Asset and expense accounts rise on debits; liability and revenue accounts
 * rise on credits. Getting this backwards is the classic double-entry bug, so
 * it lives in one function rather than being written out at each call site.
 */
export function balanceEffectPaise(
  account: LedgerAccount,
  debitPaise: number,
  creditPaise: number,
): number {
  const nature = ACCOUNT_NATURE[account];
  const risesOnDebit = nature === AccountNature.ASSET || nature === AccountNature.EXPENSE;

  return risesOnDebit ? debitPaise - creditPaise : creditPaise - debitPaise;
}
