/**
 * Payment vocabulary and the gateway seam (spec §2.10, §2.11).
 *
 * Decision B3: **Razorpay**. Chosen for UPI-native collection, Route for
 * marketplace settlement, WhatsApp payment links, and because it is an
 * RBI-licensed domestic payment aggregator — see the decision log.
 *
 * Nothing in this file names Razorpay, deliberately. The provider sits behind
 * an interface so the choice is a binding change: if Cashfree comes back
 * cheaper, the order flow does not move.
 */

import { PaymentMethod, PaymentStatus } from './payment-status';

/**
 * What the customer's app needs to actually pay.
 *
 * Deliberately provider-shaped-but-not-provider-specific: an id to hand to the
 * SDK, an amount, and a short-lived window. Anything more specific here would
 * leak one gateway's model into the storefront.
 */
export interface PaymentIntent {
  /** Our payment row. The client echoes it back so we can match a return. */
  paymentId: string;
  /** The provider's order handle, which the checkout SDK opens. */
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  method: PaymentMethod;
  /** After this, the intent is dead and the reservation is released (§2.5). */
  expiresAt: string;
}

/**
 * A payment event from the gateway, normalised.
 *
 * `providerEventId` is the replay key. Gateways redeliver — that is documented
 * behaviour, not an edge case — and applying "captured" twice against an order
 * is how a customer gets charged once and credited twice.
 */
export interface PaymentEvent {
  providerEventId: string;
  providerPaymentId: string;
  providerOrderId: string;
  status: PaymentStatus;
  amountPaise: number;
  method: PaymentMethod | null;
  /** Why it failed, in the provider's words. Shown to nobody; logged for support. */
  failureReason: string | null;
  raw: Record<string, unknown>;
}

/** What the provider says about a payment when we ask directly (§2.10.3). */
export interface PaymentSnapshot {
  providerPaymentId: string | null;
  status: PaymentStatus;
  amountPaise: number;
  method: PaymentMethod | null;
  failureReason: string | null;
}

export interface CreateIntentInput {
  paymentId: string;
  amountPaise: number;
  method: PaymentMethod;
  orderNumber: string;
  customerPhone: string;
  /** Rule R4. The provider must not create two orders for one checkout. */
  idempotencyKey: string;
}

/**
 * The gateway (§2.10.2).
 *
 * `verifySignature` is separate from `parseWebhook` on purpose: a body that
 * fails verification must never be parsed, let alone acted on. Splitting them
 * makes it impossible to write the handler in the wrong order.
 */
export interface PaymentProvider {
  readonly name: string;

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;

  /** Constant-time comparison against the webhook secret. */
  verifySignature(rawBody: string, signature: string | undefined): boolean;

  parseWebhook(rawBody: string): PaymentEvent | null;

  /**
   * Asks the provider what actually happened.
   *
   * The recovery path for §2.10.3: webhooks are lost, and an order stuck in
   * PENDING_PAYMENT while the customer's money is gone is the worst failure
   * this system has.
   */
  fetchPayment(providerOrderId: string): Promise<PaymentSnapshot | null>;

  /**
   * Sends money back down the rail it came up (§1.8.2).
   *
   * Takes the *payment* id rather than the order id: a refund reverses one
   * specific capture, and an order that was retried has more than one payment
   * row with only one of them captured.
   *
   * `amountPaise` is explicit rather than implied, because a partial refund is
   * the normal case in grocery — a missing item, an underweight line — and a
   * method that refunded "the payment" would make the common case the awkward
   * one.
   */
  refund(input: RefundRequest): Promise<RefundResult>;
}

export interface RefundRequest {
  providerPaymentId: string;
  amountPaise: number;
  /** Rule R4. The provider must reject a repeat rather than pay twice. */
  idempotencyKey: string;
  notes?: Record<string, string>;
}

export interface RefundResult {
  providerRefundId: string;
  /** Providers settle asynchronously; `PROCESSING` is the normal answer. */
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  amountPaise: number;
  failureReason?: string;
}

/**
 * How long a customer has to finish paying.
 *
 * Matched to the §2.5 reservation TTL on purpose: the stock is held for exactly
 * as long as the payment window, so an abandoned payment and an abandoned hold
 * expire together. Two different clocks here would mean either stock released
 * while somebody is still paying, or stock held after the payment died.
 */
export const PAYMENT_WINDOW_MINUTES = 10;

/** Payment states from which nothing further happens on its own. */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.CAPTURED,
  PaymentStatus.FAILED,
  PaymentStatus.REFUNDED,
];

export function isSettled(status: PaymentStatus): boolean {
  return (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a payment method needs the gateway at all.
 *
 * COD is a payment method with no payment: the money arrives at the door, so
 * the order goes straight to the store instead of waiting on a gateway.
 */
export function needsGateway(method: PaymentMethod): boolean {
  return method !== PaymentMethod.COD;
}

/**
 * UPI cannot hold an authorisation the way a card can.
 *
 * §2.10.2 asks for auth with downward-adjusted capture and a seven-day hold.
 * That is a card capability; UPI captures immediately. For variable-weight
 * orders (§1.7.1, P4.2) the workable pattern is therefore **capture the
 * estimate, refund the difference** once the picker weighs it — not
 * authorise-then-capture-less.
 *
 * Stated here rather than in a comment on one call site, because it is a
 * constraint on the product, not on this module.
 */
export function supportsAuthorisationHold(method: PaymentMethod): boolean {
  return method === PaymentMethod.CARD;
}
