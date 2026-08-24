import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerAccount, LedgerError, LedgerRef, ScopeKind } from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { requireDatabase } from '../../../testing/database';
import { LedgerService } from './ledger.service';

/**
 * The ledger (spec §2.4.4, rule R5, readiness G5).
 *
 * The confirm step for P5.1: follow **one trade cycle end to end** — buy stock,
 * move it to a branch, sell it on credit, collect the cash, bank it — and prove
 * the numbers that run the business fall out of the ledger rather than being
 * assembled by hand. Then post an unbalanced entry and prove it is *rejected
 * rather than stored*.
 */
describe('ledger (e2e)', () => {
  let app: INestApplication;
  let ledger: LedgerService;

  /** Scoped to this run, so a shared staging ledger cannot cross-talk. */
  const hub = `hub-${randomUUID().slice(0, 8)}`;
  const branch = `br-${randomUUID().slice(0, 8)}`;
  const supplier = `sup-${randomUUID().slice(0, 8)}`;
  const customer = `cust-${randomUUID().slice(0, 8)}`;
  const driver = `drv-${randomUUID().slice(0, 8)}`;

  const p = (n: number) => n as never;
  const dr = (account: LedgerAccount, amount: number, scopeId?: string) => ({
    account,
    scopeId: scopeId ?? null,
    debitPaise: p(amount),
    creditPaise: p(0),
  });
  const cr = (account: LedgerAccount, amount: number, scopeId?: string) => ({
    account,
    scopeId: scopeId ?? null,
    debitPaise: p(0),
    creditPaise: p(amount),
  });

  beforeAll(async () => {
    if (!(await requireDatabase('ledger.entry'))) return;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ledger = app.get(LedgerService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('one trade cycle, followed end to end', () => {
    it('receives goods: stock in at landed cost, tax recoverable, supplier owed', async () => {
      // ₹20,000 of goods, ₹500 of inward freight paid in cash, 5% GST.
      // Landed cost is goods plus freight — ₹20,500 — and that is what the
      // stock is worth from this moment on. Getting this wrong makes every
      // margin figure downstream fiction.
      await ledger.post({
        postings: [
          dr(LedgerAccount.INVENTORY, 2_050_000, hub),
          dr(LedgerAccount.GST_INPUT_CREDIT, 100_000),
          cr(LedgerAccount.SUPPLIER_PAYABLE, 2_100_000, supplier),
          cr(LedgerAccount.CASH_IN_HAND, 50_000, hub),
        ],
        refType: LedgerRef.GRN,
        refId: randomUUID(),
        description: 'Goods received at hub',
      });

      const stock = await ledger.balance(LedgerAccount.INVENTORY, hub);
      expect(stock.balancePaise).toBe(2_050_000);

      const owed = await ledger.balance(LedgerAccount.SUPPLIER_PAYABLE, supplier);
      expect(owed.balancePaise).toBe(2_100_000);
    });

    it('moves stock to a branch: same value, different place, no tax leg', async () => {
      // Same state, one GSTIN (decision D-B1), so a transfer is a delivery
      // challan and not a supply. The stock keeps its landed cost across the
      // move — only its location changes.
      await ledger.post({
        postings: [
          dr(LedgerAccount.INVENTORY_IN_TRANSIT, 1_080_000, branch),
          cr(LedgerAccount.INVENTORY, 1_080_000, hub),
        ],
        refType: LedgerRef.TRANSFER,
        refId: randomUUID(),
        description: 'Dispatched hub to branch',
      });

      // In transit belongs to neither end, and must be sellable from neither.
      const moving = await ledger.balance(LedgerAccount.INVENTORY_IN_TRANSIT, branch);
      expect(moving.balancePaise).toBe(1_080_000);
      const atHub = await ledger.balance(LedgerAccount.INVENTORY, hub);
      expect(atHub.balancePaise).toBe(970_000);
    });

    it('receives the transfer at the branch', async () => {
      await ledger.post({
        postings: [
          dr(LedgerAccount.INVENTORY, 1_080_000, branch),
          cr(LedgerAccount.INVENTORY_IN_TRANSIT, 1_080_000, branch),
        ],
        refType: LedgerRef.TRANSFER,
        refId: randomUUID(),
      });

      const moving = await ledger.balance(LedgerAccount.INVENTORY_IN_TRANSIT, branch);
      expect(moving.balancePaise).toBe(0);
      const atBranch = await ledger.balance(LedgerAccount.INVENTORY, branch);
      expect(atBranch.balancePaise).toBe(1_080_000);
    });

    it('invoices a shop on credit, and margin falls straight out', async () => {
      // Revenue and cost of goods are pooled, not scoped, so a shared ledger
      // carries whatever earlier runs left behind. Compare the *movement*, not
      // the absolute balance, or this passes once and fails forever after.
      const revenueBefore = (await ledger.balance(LedgerAccount.SALES_REVENUE))
        .balancePaise;
      const costBefore = (await ledger.balance(LedgerAccount.COGS)).balancePaise;

      // ₹12,000 of goods at ₹10,800 landed cost, 5% GST. Revenue, tax,
      // receivable and cost of goods are one event, so gross margin is a
      // subtraction of two ledger balances rather than a spreadsheet.
      await ledger.post({
        postings: [
          dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_260_000, customer),
          cr(LedgerAccount.SALES_REVENUE, 1_200_000),
          cr(LedgerAccount.GST_OUTPUT_PAYABLE, 60_000),
          dr(LedgerAccount.COGS, 1_080_000),
          cr(LedgerAccount.INVENTORY, 1_080_000, branch),
        ],
        refType: LedgerRef.INVOICE,
        refId: randomUUID(),
        description: 'Invoice to retail shop',
      });

      const owed = await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, customer);
      expect(owed.balancePaise).toBe(1_260_000);

      // The branch sold everything it received.
      const atBranch = await ledger.balance(LedgerAccount.INVENTORY, branch);
      expect(atBranch.balancePaise).toBe(0);

      // Gross margin, computed rather than asserted: ₹12,000 − ₹10,800.
      const revenue = (await ledger.balance(LedgerAccount.SALES_REVENUE)).balancePaise;
      const cost = (await ledger.balance(LedgerAccount.COGS)).balancePaise;
      expect(revenue - revenueBefore - (cost - costBefore)).toBe(120_000);
    });

    it('collects at the door: the driver is carrying it', async () => {
      await ledger.post({
        postings: [
          dr(LedgerAccount.CASH_IN_TRANSIT, 1_260_000, driver),
          cr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_260_000, customer),
        ],
        refType: LedgerRef.RECEIPT,
        refId: randomUUID(),
        description: 'Cash collected on delivery',
      });

      // The customer is square — this is what "paid" means, and it is a
      // computed fact rather than a flag somebody remembered to set.
      const owed = await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, customer);
      expect(owed.balancePaise).toBe(0);

      const carrying = await ledger.balance(LedgerAccount.CASH_IN_TRANSIT, driver);
      expect(carrying.balancePaise).toBe(1_260_000);
    });

    it('banks the cash, and the driver is square', async () => {
      await ledger.post({
        postings: [
          dr(LedgerAccount.BANK, 1_260_000),
          cr(LedgerAccount.CASH_IN_TRANSIT, 1_260_000, driver),
        ],
        refType: LedgerRef.CASH_DEPOSIT,
      });

      // A non-zero balance here after the deposit deadline *is* the shortfall,
      // and it is attributable to one person. That is why this is scoped.
      const carrying = await ledger.balance(LedgerAccount.CASH_IN_TRANSIT, driver);
      expect(carrying.balancePaise).toBe(0);
    });

    it('pays the supplier', async () => {
      await ledger.post({
        postings: [
          dr(LedgerAccount.SUPPLIER_PAYABLE, 2_100_000, supplier),
          cr(LedgerAccount.BANK, 2_100_000),
        ],
        refType: LedgerRef.SUPPLIER_PAYMENT,
        refId: randomUUID(),
      });

      const owed = await ledger.balance(LedgerAccount.SUPPLIER_PAYABLE, supplier);
      expect(owed.balancePaise).toBe(0);
    });
  });

  describe('the losses, kept apart', () => {
    it('writes off spoiled stock as wastage', async () => {
      const before = (await ledger.balance(LedgerAccount.WASTAGE)).balancePaise;

      // Goods that no longer exist. Posted daily, per location — not discovered
      // as a plug figure at year end.
      await ledger.post({
        postings: [
          dr(LedgerAccount.WASTAGE, 30_000),
          cr(LedgerAccount.INVENTORY, 30_000, hub),
        ],
        refType: LedgerRef.WASTAGE,
        description: 'Spoiled produce, hub',
      });

      const after = (await ledger.balance(LedgerAccount.WASTAGE)).balancePaise;
      expect(after - before).toBe(30_000);
    });

    it('writes off a bad debt separately from wastage', async () => {
      // A debt forgiven is not a crate destroyed. Different owner, different
      // control, different remedy — pooling them hides the fixable one.
      const deadbeat = `cust-${randomUUID().slice(0, 8)}`;
      const writeOffBefore = (await ledger.balance(LedgerAccount.WRITE_OFF)).balancePaise;
      const wastageBefore = (await ledger.balance(LedgerAccount.WASTAGE)).balancePaise;

      await ledger.post({
        postings: [
          dr(LedgerAccount.CUSTOMER_RECEIVABLE, 500_000, deadbeat),
          cr(LedgerAccount.SALES_REVENUE, 500_000),
        ],
        refType: LedgerRef.INVOICE,
        refId: randomUUID(),
      });
      await ledger.post({
        postings: [
          dr(LedgerAccount.WRITE_OFF, 500_000),
          cr(LedgerAccount.CUSTOMER_RECEIVABLE, 500_000, deadbeat),
        ],
        refType: LedgerRef.ADJUSTMENT,
      });

      const writeOffAfter = (await ledger.balance(LedgerAccount.WRITE_OFF)).balancePaise;
      expect(writeOffAfter - writeOffBefore).toBe(500_000);
      // Wastage untouched: the two losses never contaminate each other.
      expect((await ledger.balance(LedgerAccount.WASTAGE)).balancePaise).toBe(
        wastageBefore,
      );
      expect(
        (await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, deadbeat)).balancePaise,
      ).toBe(0);
    });

    it('credits a return without disturbing anybody else', async () => {
      const returner = `cust-${randomUUID().slice(0, 8)}`;

      await ledger.post({
        postings: [
          dr(LedgerAccount.CUSTOMER_RECEIVABLE, 210_000, returner),
          cr(LedgerAccount.SALES_REVENUE, 200_000),
          cr(LedgerAccount.GST_OUTPUT_PAYABLE, 10_000),
        ],
        refType: LedgerRef.INVOICE,
        refId: randomUUID(),
      });
      // Saleable stock coming back re-enters at its original landed cost.
      await ledger.post({
        postings: [
          dr(LedgerAccount.SALES_REVENUE, 100_000),
          dr(LedgerAccount.GST_OUTPUT_PAYABLE, 5_000),
          cr(LedgerAccount.CUSTOMER_RECEIVABLE, 105_000, returner),
        ],
        refType: LedgerRef.CREDIT_NOTE,
        refId: randomUUID(),
      });

      expect(
        (await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, returner)).balancePaise,
      ).toBe(105_000);
      // The first customer's balance is untouched by another's credit note.
      expect(
        (await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, customer)).balancePaise,
      ).toBe(0);
    });
  });

  describe('an entry that does not balance', () => {
    it('is rejected, not stored', async () => {
      // The confirm step for P5.1, and the reason readiness G5 exists: a ledger
      // that can go unbalanced silently is worse than no ledger.
      const before = await ledger.checkIntegrity();

      await expect(
        ledger.post({
          postings: [
            dr(LedgerAccount.CUSTOMER_RECEIVABLE, 60_000, customer),
            cr(LedgerAccount.SALES_REVENUE, 50_000),
          ],
          refType: LedgerRef.ADJUSTMENT,
        }),
      ).rejects.toMatchObject({
        response: { code: LedgerError.UNBALANCED, differencePaise: 10_000 },
      });

      const after = await ledger.checkIntegrity();
      // Nothing was written: the transaction count did not move.
      expect(after.transactions).toBe(before.transactions);
      expect(after.ok).toBe(true);
    });

    it('is rejected for a missing customer on a receivable, and names the scope', async () => {
      await expect(
        ledger.post({
          postings: [
            dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_000),
            cr(LedgerAccount.SALES_REVENUE, 1_000),
          ],
          refType: LedgerRef.ADJUSTMENT,
        }),
      ).rejects.toMatchObject({
        response: {
          code: LedgerError.MISSING_SCOPE,
          expectedScope: ScopeKind.CUSTOMER,
          account: LedgerAccount.CUSTOMER_RECEIVABLE,
        },
      });
    });

    it('is rejected for stock with no location', async () => {
      await expect(
        ledger.post({
          postings: [
            dr(LedgerAccount.INVENTORY, 1_000),
            cr(LedgerAccount.SUPPLIER_PAYABLE, 1_000, supplier),
          ],
          refType: LedgerRef.GRN,
        }),
      ).rejects.toMatchObject({
        response: { code: LedgerError.MISSING_SCOPE, expectedScope: ScopeKind.LOCATION },
      });
    });
  });

  describe('posting the same event twice', () => {
    it('writes it once', async () => {
      // Payment webhooks and job retries arrive more than once by design. A
      // replay that doubled a customer's receivable would be the most
      // expensive kind of bug: it is money somebody is asked to pay twice.
      const txnId = randomUUID();
      const postings = [
        dr(LedgerAccount.CUSTOMER_RECEIVABLE, 1_500, customer),
        cr(LedgerAccount.SALES_REVENUE, 1_500),
      ];

      const first = await ledger.post({
        postings,
        refType: LedgerRef.INVOICE,
        txnId,
      });
      const second = await ledger.post({
        postings,
        refType: LedgerRef.INVOICE,
        txnId,
      });

      expect(first.postings).toBe(2);
      expect(second.postings).toBe(0);
      // And the customer owes ₹15, not ₹30.
      expect(
        (await ledger.balance(LedgerAccount.CUSTOMER_RECEIVABLE, customer)).balancePaise,
      ).toBe(1_500);
    });
  });

  describe('the nightly integrity job', () => {
    it('finds every transaction balanced, and the whole ledger too', async () => {
      const report = await ledger.checkIntegrity();

      expect(report.unbalanced).toEqual([]);
      expect(report.ok).toBe(true);
      // Both questions matter: two transactions wrong by equal and opposite
      // amounts would pass the total while failing per-transaction.
      expect(report.totalDebitsPaise).toBe(report.totalCreditsPaise);
    });
  });
});
