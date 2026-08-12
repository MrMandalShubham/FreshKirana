/**
 * Payment status (spec §2.6.2).
 *
 * Deliberately orthogonal to `OrderStatus`. Conflating fulfilment progress with
 * payment progress is the classic and expensive marketplace modelling mistake:
 * a delivered order can be unrefunded, partially refunded or fully refunded,
 * and a COD order is fulfilled long before it is captured.
 */

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORISED: 'AUTHORISED',
  COD_COLLECTED: 'COD_COLLECTED',
  CAPTURED: 'CAPTURED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUSES = Object.values(PaymentStatus);

/** Payment methods. Cards and wallets are fast-follow (§1.5.1, §2.10.1). */
export const PaymentMethod = {
  UPI_INTENT: 'UPI_INTENT',
  UPI_COLLECT: 'UPI_COLLECT',
  COD: 'COD',
  CARD: 'CARD',
  WALLET: 'WALLET',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export function isPrepaid(method: PaymentMethod): boolean {
  return method !== PaymentMethod.COD;
}

/** COD risk bands (spec §2.10.4). Thresholds are ops-configurable, not compiled in. */
export const CodRiskBand = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  BLOCKED: 'BLOCKED',
} as const;

export type CodRiskBand = (typeof CodRiskBand)[keyof typeof CodRiskBand];
