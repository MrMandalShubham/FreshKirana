/**
 * Public interface of the order module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `checkout` creates orders; the state machine (P2.4), payments, delivery and
 * settlement all read and advance them through here.
 */

export { OrderService } from './internal/order.service';
export type { CreateOrderInput, CreateOrderLineInput } from './internal/order.service';

export type { OrderRow, OrderLineRow } from './schema';

export {
  OrderStatus,
  OrderLineStatus,
  PaymentStatus,
  PaymentMethod,
  SubstitutionPreference,
  isTerminalOrderStatus,
} from '@freshkirana/contracts';
