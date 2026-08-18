/**
 * Public interface of the vendor module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `offer` uses this to confirm a vendor exists and is allowed to sell before
 * accepting a listing — it must never join to the `vendor` schema itself.
 */

export { VendorService } from './internal/vendor.service';
export { VendorStatus, GstRegistrationType } from './internal/vendor.dto';
export type { VendorRow } from './schema';
