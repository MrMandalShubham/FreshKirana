import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NATURE,
  ACCOUNT_SCOPE,
  AccountNature,
  LedgerAccount,
  LedgerError,
  SCOPED_ACCOUNTS,
  ScopeKind,
  balanceEffectPaise,
  checkPostings,
  isLedgerAccount,
  requiresScope,
  scopeKindFor,
} from './ledger';
import type { Paise } from './money';

const p = (n: number) => n as Paise;

/** A debit posting. */
const dr = (account: LedgerAccount, amount: number, scopeId?: string) => ({
  account,
  scopeId: scopeId ?? null,
  debitPaise: p(amount),
  creditPaise: p(0),
});

/** A credit posting. */
const cr = (account: LedgerAccount, amount: number, scopeId?: string) => ({
  account,
  scopeId: scopeId ?? null,
  debitPaise: p(0),
  creditPaise: p(amount),
});

describe('the balance invariant (§2.4.4, rule R5)', () => {
  it('accepts a sale on credit: the customer owes us, and the goods leave stock', () => {
    // ₹12,000 of goods at ₹10,800 landed cost, 5% GST. Two halves of one event:
    // what the customer owes, and what it cost us to owe it to them.
    const check = checkPostings([
      dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_260_000, 'customer-1'),
      cr(LedgerAccount.SALES_REVENUE, 1_200_000),
      cr(LedgerAccount.GST_OUTPUT_PAYABLE, 60_000),
      dr(LedgerAccount.COGS, 1_080_000),
      cr(LedgerAccount.INVENTORY, 1_080_000, 'branch-1'),
    ]);

    expect(check.ok).toBe(true);
  });

  it('refuses an entry that does not balance, and says by how much', () => {
    // The one that matters. A ledger that can go unbalanced silently is worse
    // than no ledger, because the wrong numbers get trusted.
    const check = checkPostings([
      dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_260_000, 'customer-1'),
      cr(LedgerAccount.SALES_REVENUE, 1_200_000),
      cr(LedgerAccount.GST_OUTPUT_PAYABLE, 50_000),
    ]);

    expect(check.ok).toBe(false);
    expect(check.error).toBe(LedgerError.UNBALANCED);
    // "By how much" is the first question anybody asks.
    expect(check.differencePaise).toBe(10_000);
  });

  it('refuses an entry with nothing in it', () => {
    expect(checkPostings([])).toEqual({ ok: false, error: LedgerError.EMPTY });
  });

  it('refuses a posting that is both a debit and a credit', () => {
    const check = checkPostings([
      {
        account: LedgerAccount.BANK,
        scopeId: null,
        debitPaise: p(100),
        creditPaise: p(100),
      },
    ]);

    expect(check.error).toBe(LedgerError.BOTH_SIDES);
  });

  it('refuses a posting that is neither', () => {
    // A zero-zero row balances perfectly and means nothing, which is worse
    // than an error: it would pass every total and explain nothing.
    const check = checkPostings([
      { account: LedgerAccount.BANK, scopeId: null, debitPaise: p(0), creditPaise: p(0) },
    ]);

    expect(check.error).toBe(LedgerError.BOTH_SIDES);
  });

  it('refuses negative amounts', () => {
    // A negative debit is a credit written the hard way. Allowing it means two
    // representations of the same movement and no way to sum a column.
    const check = checkPostings([
      {
        account: LedgerAccount.BANK,
        scopeId: null,
        debitPaise: p(-500),
        creditPaise: p(0),
      },
      cr(LedgerAccount.SALES_REVENUE, -500),
    ]);

    expect(check.error).toBe(LedgerError.NEGATIVE);
  });

  it('balances across many postings, not just two', () => {
    // Goods received: stock in at landed cost, tax recoverable, supplier owed.
    const check = checkPostings([
      dr(LedgerAccount.INVENTORY, 1_000_000, 'hub'),
      dr(LedgerAccount.GST_INPUT_CREDIT, 50_000),
      cr(LedgerAccount.SUPPLIER_PAYABLE, 1_040_000, 'supplier-1'),
      cr(LedgerAccount.BANK, 10_000),
    ]);

    expect(check.ok).toBe(true);
  });
});

describe('scoped accounts', () => {
  it('requires a customer on a receivable', () => {
    // Pooled, "what does Sharma General Store owe us?" has no answer — and that
    // question is the entire reason the credit book exists.
    const check = checkPostings([
      dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_000),
      cr(LedgerAccount.SALES_REVENUE, 1_000),
    ]);

    expect(check.error).toBe(LedgerError.MISSING_SCOPE);
    expect(check.expectedScope).toBe(ScopeKind.CUSTOMER);
    expect(check.account).toBe(LedgerAccount.CUSTOMER_RECEIVABLE);
  });

  it('requires a supplier on a payable', () => {
    const check = checkPostings([
      dr(LedgerAccount.INVENTORY, 1_000, 'hub'),
      cr(LedgerAccount.SUPPLIER_PAYABLE, 1_000),
    ]);

    expect(check.error).toBe(LedgerError.MISSING_SCOPE);
    expect(check.expectedScope).toBe(ScopeKind.SUPPLIER);
  });

  it('requires a location on inventory', () => {
    // Stock with no location is stock nobody can pick, count or value.
    const check = checkPostings([
      dr(LedgerAccount.INVENTORY, 1_000),
      cr(LedgerAccount.SUPPLIER_PAYABLE, 1_000, 'supplier-1'),
    ]);

    expect(check.error).toBe(LedgerError.MISSING_SCOPE);
    expect(check.expectedScope).toBe(ScopeKind.LOCATION);
  });

  it('requires a driver on cash in transit', () => {
    const check = checkPostings([
      dr(LedgerAccount.CASH_IN_TRANSIT, 1_000),
      cr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_000, 'customer-1'),
    ]);

    expect(check.error).toBe(LedgerError.MISSING_SCOPE);
    expect(check.expectedScope).toBe(ScopeKind.DRIVER);
  });

  it('refuses a scope on an account that has none', () => {
    // Sales revenue scoped to a customer would silently create a second,
    // parallel set of revenue accounts nobody totals.
    const check = checkPostings([
      dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_000, 'customer-1'),
      cr(LedgerAccount.SALES_REVENUE, 1_000, 'customer-1'),
    ]);

    expect(check.error).toBe(LedgerError.UNEXPECTED_SCOPE);
    expect(check.account).toBe(LedgerAccount.SALES_REVENUE);
  });

  it('knows which accounts are scoped, and by what', () => {
    expect(requiresScope(LedgerAccount.CUSTOMER_RECEIVABLE)).toBe(true);
    expect(requiresScope(LedgerAccount.SUPPLIER_PAYABLE)).toBe(true);
    expect(requiresScope(LedgerAccount.INVENTORY)).toBe(true);
    expect(requiresScope(LedgerAccount.CASH_IN_TRANSIT)).toBe(true);
    expect(requiresScope(LedgerAccount.BANK)).toBe(false);
    expect(requiresScope(LedgerAccount.SALES_REVENUE)).toBe(false);

    expect(scopeKindFor(LedgerAccount.CUSTOMER_RECEIVABLE)).toBe(ScopeKind.CUSTOMER);
    expect(scopeKindFor(LedgerAccount.INVENTORY)).toBe(ScopeKind.LOCATION);
    expect(scopeKindFor(LedgerAccount.BANK)).toBeNull();
  });

  it('derives the scoped list from the scope map, so the two cannot drift', () => {
    for (const account of SCOPED_ACCOUNTS) {
      expect(ACCOUNT_SCOPE[account], `${account} is listed as scoped`).not.toBeNull();
    }
    expect(SCOPED_ACCOUNTS).toContain(LedgerAccount.CUSTOMER_RECEIVABLE);
    expect(SCOPED_ACCOUNTS).not.toContain(LedgerAccount.COGS);
  });
});

describe('which way an account moves', () => {
  it('raises an asset on a debit', () => {
    expect(balanceEffectPaise(LedgerAccount.BANK, 5_000, 0)).toBe(5_000);
    expect(balanceEffectPaise(LedgerAccount.BANK, 0, 5_000)).toBe(-5_000);
  });

  it('raises a receivable on a debit, and clears it on a credit', () => {
    // Invoice the customer, then collect: the balance must return to zero.
    expect(balanceEffectPaise(LedgerAccount.CUSTOMER_RECEIVABLE, 1_260_000, 0)).toBe(
      1_260_000,
    );
    expect(balanceEffectPaise(LedgerAccount.CUSTOMER_RECEIVABLE, 0, 1_260_000)).toBe(
      -1_260_000,
    );
  });

  it('raises a liability on a credit', () => {
    // The classic double-entry bug is getting this backwards, which is why it
    // lives in one function rather than at each call site.
    expect(balanceEffectPaise(LedgerAccount.SUPPLIER_PAYABLE, 0, 5_000)).toBe(5_000);
    expect(balanceEffectPaise(LedgerAccount.SUPPLIER_PAYABLE, 5_000, 0)).toBe(-5_000);
  });

  it('raises revenue on a credit', () => {
    expect(balanceEffectPaise(LedgerAccount.SALES_REVENUE, 0, 1_200_000)).toBe(1_200_000);
  });

  it('raises an expense on a debit', () => {
    expect(balanceEffectPaise(LedgerAccount.COGS, 1_080_000, 0)).toBe(1_080_000);
    expect(balanceEffectPaise(LedgerAccount.WASTAGE, 900, 0)).toBe(900);
  });
});

describe('gross margin falls out of the ledger', () => {
  it('is revenue less cost of goods, from the postings themselves', () => {
    // The reason COGS is posted on the same entry as the sale: margin is a
    // subtraction of two ledger balances, never a spreadsheet reconciling a
    // purchase file against a sales file.
    const revenue = balanceEffectPaise(LedgerAccount.SALES_REVENUE, 0, 1_200_000);
    const cost = balanceEffectPaise(LedgerAccount.COGS, 1_080_000, 0);

    expect(revenue - cost).toBe(120_000); // ₹1,200 on a ₹12,000 invoice
  });
});

describe('the account catalogue', () => {
  it('gives every account a nature', () => {
    // A missing nature would make `balanceEffectPaise` return NaN and quietly
    // corrupt every balance that account touches.
    for (const account of Object.values(LedgerAccount)) {
      expect(ACCOUNT_NATURE[account], `${account} has no nature`).toBeTruthy();
      expect(Object.values(AccountNature)).toContain(ACCOUNT_NATURE[account]);
    }
  });

  it('gives every account a scope decision, even if that decision is "none"', () => {
    // `undefined` here would read as unscoped and silently pool a balance that
    // was meant to be per customer.
    for (const account of Object.values(LedgerAccount)) {
      expect(ACCOUNT_SCOPE, `${account} has no scope decision`).toHaveProperty(account);
      const scope = ACCOUNT_SCOPE[account];
      if (scope !== null) {
        expect(Object.values(ScopeKind)).toContain(scope);
      }
    }
  });

  it('rejects an account it does not know', () => {
    expect(isLedgerAccount('CUSTOMER_RECEIVABLE')).toBe(true);
    expect(isLedgerAccount('petty_cash')).toBe(false);
  });

  it('no longer carries the marketplace accounts', () => {
    // We are the principal supplier, not an e-commerce operator: commission,
    // vendor payouts and the §52 / 194-O deductions do not apply. Asserted so a
    // future merge cannot quietly reintroduce them.
    for (const gone of [
      'PLATFORM_REVENUE',
      'VENDOR_PAYABLE',
      'GST_TCS_PAYABLE',
      'TDS_PAYABLE',
      'COD_CASH_IN_TRANSIT',
    ]) {
      expect(isLedgerAccount(gone), `${gone} should be gone`).toBe(false);
    }
  });
});
