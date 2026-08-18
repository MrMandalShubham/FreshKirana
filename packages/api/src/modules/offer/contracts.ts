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
export { OfferStatus } from './internal/offer.dto';
export type { VendorOfferRow } from './schema';
