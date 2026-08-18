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

export { VendorOrderFlowService } from './internal/vendor-order-flow.service';
export type { InboundOutcome } from './internal/vendor-order-flow.service';

export { OrderStateService } from './internal/order-state.service';
export type { TransitionActor, TransitionOptions } from './internal/order-state.service';

export type { OrderRow, OrderLineRow, OrderStatusHistoryRow } from './schema';

export {
  Audience,
  OrderStatus,
  OrderLineStatus,
  PaymentStatus,
  PaymentMethod,
  SubstitutionPreference,
  allowedTransitions,
  findTransition,
  isTerminalOrderStatus,
  isTransitionAllowed,
  labelFor,
} from '@freshkirana/contracts';
