/**
 * Refunds and cancellations (spec §1.8.1, §1.8.2).
 *
 * A refund is the most sensitive thing this system does, for a reason worth
 * stating plainly: it is the moment a customer is already unhappy, and getting
 * it wrong compounds the original failure. Every rule here is shaped by that —
 * an amount is never guessed, a promise is never made that cannot be kept, and
 * a refund that cannot be routed is surfaced rather than swallowed.
 */

import { OrderStatus } from './order-status';
import { PaymentMethod } from './payment-status';

/**
 * Why money is going back.
 *
 * Kept distinct because they carry different liability (§1.8.4) and feed
 * different numbers: a store that cancels after accepting is a §6.4 vendor
 * score problem, and a customer who cancels before that is not a problem at
 * all.
 */
export const RefundReason = {
  CUSTOMER_CANCELLED: 'CUSTOMER_CANCELLED',
  VENDOR_CANCELLED: 'VENDOR_CANCELLED',
  /** The acceptance SLA lapsed, or reassignment found nobody (§1.9.4). */
  SYSTEM_CANCELLED: 'SYSTEM_CANCELLED',
  /** A line could not be filled and the customer wanted the money back. */
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  /** Variable weight came in under the estimate (§1.7.1). */
  WEIGHT_SHORTFALL: 'WEIGHT_SHORTFALL',
  /** Quality complaint, damage, or a return (§1.8.3). */
  RETURN: 'RETURN',
  /** Ops decided, outside the rules. Always attributable. */
  GOODWILL: 'GOODWILL',
} as const;

export type RefundReason = (typeof RefundReason)[keyof typeof RefundReason];

/** Where the money goes (§1.8.2). */
export const RefundRoute = {
  /** Back down the rail it arrived on. The only route for prepaid. */
  ORIGINAL_METHOD: 'ORIGINAL_METHOD',
  /** For cash orders, where there is no rail to reverse. */
  BANK_TRANSFER: 'BANK_TRANSFER',
  /** Faster and cheaper, and opt-in only — see the note below. */
  STORE_CREDIT: 'STORE_CREDIT',
} as const;

export type RefundRoute = (typeof RefundRoute)[keyof typeof RefundRoute];

export const RefundStatus = {
  /** Owed, not yet sent to anyone. */
  PENDING: 'PENDING',
  /** Handed to the gateway or the payouts process. */
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  /** The gateway refused it. Needs a human. */
  FAILED: 'FAILED',
} as const;

export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const REFUND_STATUSES = Object.values(RefundStatus);

/**
 * Where a refund goes, given how the order was paid (§1.8.2).
 *
 * Prepaid money goes back the way it came — always. Refunding a card payment
 * to a bank account is how money laundering controls get tripped, and it is
 * also simply not the customer's expectation.
 *
 * Cash has no rail to reverse, so it needs somewhere to go. §1.8.2 allows store
 * credit as an **opt-in alternative to a refund already owed** — never as a
 * default, because a stored-value instrument the customer did not choose has
 * RBI prepaid-instrument implications, and "we kept your money as credit" is
 * how a refund becomes a complaint.
 */
export function routeFor(
  method: PaymentMethod,
  customerChoseStoreCredit = false,
): RefundRoute {
  if (method !== PaymentMethod.COD) return RefundRoute.ORIGINAL_METHOD;
  return customerChoseStoreCredit ? RefundRoute.STORE_CREDIT : RefundRoute.BANK_TRANSFER;
}

/**
 * What the customer is told to expect, in working days (§1.8.2).
 *
 * A range, not a promise of a date. The gateway controls the actual timing and
 * routinely takes the long end, so a single date is a promise this system
 * cannot keep — and a refund that arrives late after a precise promise is a
 * second failure on top of the first.
 */
export interface RefundEta {
  minDays: number;
  maxDays: number;
}

export const REFUND_ETA: Record<RefundRoute, RefundEta> = {
  [RefundRoute.ORIGINAL_METHOD]: { minDays: 3, maxDays: 7 },
  [RefundRoute.BANK_TRANSFER]: { minDays: 3, maxDays: 5 },
  // The one route we control end to end, which is the whole argument for it.
  [RefundRoute.STORE_CREDIT]: { minDays: 0, maxDays: 1 },
};

export function etaFor(route: RefundRoute): RefundEta {
  return REFUND_ETA[route] ?? { minDays: 3, maxDays: 7 };
}

/**
 * Statuses from which a cancellation owes the customer money back.
 *
 * Not the same as "may be cancelled" — that is §1.8.1 and lives in the
 * transition table. This answers the separate question of whether anything was
 * ever taken, which for a cash order is nothing at all until the rider is paid.
 */
export const REFUNDABLE_ON_CANCEL: readonly OrderStatus[] = [
  OrderStatus.AWAITING_VENDOR,
  OrderStatus.ACCEPTED,
  OrderStatus.PICKING,
  OrderStatus.SUBSTITUTION_PENDING,
  OrderStatus.PACKED,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

/**
 * The cancellation fee (§1.8.1).
 *
 * Zero by default in V1, and the spec says so explicitly. The mechanism exists
 * because "cancelled after the shop packed it" is real wasted work, and the
 * moment a pilot city wants to charge for it the answer should not be a code
 * change. Charged only from PACKED — before that nobody has done anything.
 */
export function cancellationFeePaise(
  status: OrderStatus,
  configuredFeePaise: number,
): number {
  if (configuredFeePaise <= 0) return 0;

  const workDone =
    status === OrderStatus.PACKED || status === OrderStatus.READY_FOR_PICKUP;

  return workDone ? configuredFeePaise : 0;
}

/**
 * What to refund, net of any fee.
 *
 * Never negative, and never more than was actually taken. Both guards exist
 * because the inputs come from different places — the order total from the
 * order, the fee from configuration — and a mistake here moves real money.
 */
export function refundableAmountPaise(
  paidPaise: number,
  alreadyRefundedPaise: number,
  feePaise = 0,
): number {
  const remaining = paidPaise - alreadyRefundedPaise - feePaise;
  return Math.max(0, remaining);
}

/** Whether this order's payments are now fully returned (§2.6.2). */
export function isFullyRefunded(paidPaise: number, refundedPaise: number): boolean {
  return paidPaise > 0 && refundedPaise >= paidPaise;
}
