/**
 * Public interface of the cart module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `checkout` (P2.3) turns a rendered cart into an order, which is why the view
 * types are exported rather than the tables.
 */

export { CartService } from './internal/cart.service';
export type { CartOwner, CartView, CartLineView } from './internal/cart.service';

export type { CartRow, CartLineRow } from './schema';

export {
  CartStatus,
  QuantityMode,
  type CartTotals,
  calculateTotals,
  lineTotalPaise,
  quantityModeFor,
  quantityStepFor,
} from '@freshkirana/contracts';
