/**
 * Public interface of the checkout module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * This module owns no tables — it orchestrates other modules' contracts — so
 * what it publishes is the workflow, not data.
 */

export { CheckoutService } from './internal/checkout.service';
export type {
  CheckoutBlocker,
  CheckoutPreview,
  PlaceOrderInput,
} from './internal/checkout.service';
