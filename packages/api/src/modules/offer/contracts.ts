/**
 * Public interface of the offer module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `search` (P1.4) resolves offers for a master product; `inventory` (P3.1) will
 * reserve against them. Neither may touch the `offer` schema directly.
 */

export { OfferService } from './internal/offer.service';

/** The §2.17.2 SubstituteRanker. Rules today, a model on the §2.17.3 trigger. */
export { RuleSubstituteRanker } from './internal/substitute-ranker.service';

/** Batches, FEFO and shelf life (§1.7.3). */
export { BatchService } from './internal/batch.service';
export type { BatchView } from './internal/batch.service';

/** The recall record. Orchestration lives in the order module. */
export { RecallRegistry } from './internal/recall.registry';
export { OfferStatus } from './internal/offer.dto';
export type { VendorOfferRow } from './schema';
