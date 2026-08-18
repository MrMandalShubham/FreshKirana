/**
 * Public interface of the pricing module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * Cart, checkout, orders and settlement all ask this module what a basket
 * costs, so that they cannot disagree.
 */

export { PricingService } from './internal/pricing.service';
export type { FeeConfig, CartTotals } from '@freshkirana/contracts';
