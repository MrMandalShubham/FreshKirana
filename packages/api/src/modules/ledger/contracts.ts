/**
 * Public interface of the ledger module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * Invoicing, goods receipt, transfers, receipts and refunds all post here. None
 * of them may read `ledger.entry` directly — the control that matters is that
 * receivables, payables, stock value and margin are computed *from the ledger*,
 * and that only holds while the ledger is the one way in and out.
 */

export { LedgerService } from './internal/ledger.service';
export type {
  AccountBalance,
  IntegrityReport,
  PostResult,
} from './internal/ledger.service';
