/**
 * Canonical order fulfilment status (spec §2.6.1).
 *
 * There is exactly one state machine. Customer, vendor and rider vocabularies
 * are *labels over* these states (§2.6.3), never parallel machines. Payment
 * status is a separate, orthogonal axis - see `payment-status.ts`.
 *
 * The transition table itself lands in P2.4; this file fixes the vocabulary so
 * every package speaks it from the first commit.
 */

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  AWAITING_VENDOR: 'AWAITING_VENDOR',
  ACCEPTED: 'ACCEPTED',
  REASSIGNING: 'REASSIGNING',
  PICKING: 'PICKING',
  SUBSTITUTION_PENDING: 'SUBSTITUTION_PENDING',
  PACKED: 'PACKED',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RTO: 'RTO',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURNED: 'RETURNED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUSES = Object.values(OrderStatus);

/**
 * States from which no further transition is possible.
 *
 * `COMPLETED` is deliberately **not** here, though it looks like an ending:
 * §2.6.1 allows `COMPLETED → RETURN_REQUESTED`, because a customer opens the
 * bag after the rider has gone. Calling it terminal would make the return path
 * unreachable — the single most expensive thing to get wrong here, since the
 * customer discovers it at exactly the moment they are already unhappy.
 *
 * "Fulfilment is over" and "nothing can happen next" are different questions;
 * this answers the second.
 */
export const TERMINAL_ORDER_STATUSES = [
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
] as const satisfies readonly OrderStatus[];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Fulfilment is over and no money is owed. Not the same as terminal. */
export function isFulfilledOrderStatus(status: OrderStatus): boolean {
  return status === OrderStatus.COMPLETED || status === OrderStatus.DELIVERED;
}

/**
 * Per-line fulfilment status (spec §2.4.2).
 *
 * Line-level status is what makes partial fulfilment, per-line substitution
 * and partial refunds possible.
 */
export const OrderLineStatus = {
  PENDING: 'PENDING',
  PICKED: 'PICKED',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SUBSTITUTED: 'SUBSTITUTED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderLineStatus = (typeof OrderLineStatus)[keyof typeof OrderLineStatus];

/** Customer substitution preference for an order (spec §1.7.2). */
export const SubstitutionPreference = {
  AUTO_SUBSTITUTE: 'AUTO_SUBSTITUTE',
  ASK_ME: 'ASK_ME',
  REFUND_ITEM: 'REFUND_ITEM',
} as const;

export type SubstitutionPreference =
  (typeof SubstitutionPreference)[keyof typeof SubstitutionPreference];

export const DEFAULT_SUBSTITUTION_PREFERENCE: SubstitutionPreference =
  SubstitutionPreference.AUTO_SUBSTITUTE;
