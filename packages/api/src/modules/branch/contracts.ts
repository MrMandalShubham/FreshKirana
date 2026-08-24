/**
 * Public interface of the branch module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `offer` uses this to confirm a branch exists and is trading before accepting a
 * listing — it must never join to the `branch` schema itself.
 */

export { BranchService } from './internal/branch.service';
export { BranchStatus, GstRegistrationType } from './internal/branch.dto';
export type { BranchRow } from './schema';
