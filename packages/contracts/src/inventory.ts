/**
 * Inventory reservation (spec §2.5, §1.9.2).
 *
 * Grocery stock is often one to five units. Without an explicit design two
 * simultaneous checkouts oversell, and the shop finds out when a picker reaches
 * an empty shelf with two orders for it.
 */

import { type InventoryMode, supportsReservation } from './uom';

/**
 * The lifecycle of a hold (§2.5).
 *
 * ```
 * HELD ──payment success──> CONFIRMED ──vendor packs──> CONSUMED
 *   │
 *   ├── payment failure / cancellation ──> RELEASED
 *   └── TTL expiry (sweeper) ────────────> RELEASED
 * ```
 *
 * `RELEASED` and `CONSUMED` are both endings, and deliberately different ones:
 * released stock goes back on the shelf, consumed stock left the building.
 * Collapsing them would make it impossible to answer where a unit went.
 */
export const ReservationStatus = {
  /** Stock is held but not paid for. Expires. */
  HELD: 'HELD',
  /** Paid, or COD accepted. No longer expires. */
  CONFIRMED: 'CONFIRMED',
  /** Picked and packed. The stock is gone for good. */
  CONSUMED: 'CONSUMED',
  /** Given back. */
  RELEASED: 'RELEASED',
} as const;

export type ReservationStatus =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

/** Holds that still occupy stock. Anything else has let go of it. */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  ReservationStatus.HELD,
  ReservationStatus.CONFIRMED,
];

export function holdsStock(status: ReservationStatus): boolean {
  return (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(status);
}

/**
 * How long a hold survives without confirmation (§2.5).
 *
 * Ten minutes for prepaid because UPI collect is slow — the customer switches
 * to their bank's app, authenticates, and comes back, and a shorter window
 * would release stock while they were still paying. Fifteen for COD that needs
 * confirmation, which involves a human answering a message.
 */
export const RESERVATION_TTL_MINUTES = {
  PREPAID: 10,
  COD_WITH_CONFIRMATION: 15,
} as const;

export function reservationTtlMinutes(paymentMethod: string): number {
  return paymentMethod === 'COD'
    ? RESERVATION_TTL_MINUTES.COD_WITH_CONFIRMATION
    : RESERVATION_TTL_MINUTES.PREPAID;
}

export function reservationExpiresAt(from: Date, ttlMinutes: number): Date {
  return new Date(from.getTime() + ttlMinutes * 60_000);
}

export function hasExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * Why a reservation was not taken.
 *
 * `MODE_DOES_NOT_RESERVE` is not a failure: §1.9.2 lets a vendor run in toggle
 * or threshold mode and accept a higher substitution rate instead of keeping
 * true counts. Treating that as an error would refuse orders from exactly the
 * shops that have not migrated up the tiers yet — which is most of them.
 */
export const ReservationOutcome = {
  RESERVED: 'RESERVED',
  MODE_DOES_NOT_RESERVE: 'MODE_DOES_NOT_RESERVE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  /** The same idempotency key was used before. The first one still stands. */
  ALREADY_RESERVED: 'ALREADY_RESERVED',
} as const;

export type ReservationOutcome =
  (typeof ReservationOutcome)[keyof typeof ReservationOutcome];

/** Only `quantity` mode reserves (§2.5, §1.9.2). */
export function modeReserves(inventoryMode: string): boolean {
  return supportsReservation(inventoryMode as InventoryMode);
}

/**
 * What is actually available to promise.
 *
 * On hand minus held, never the raw count. A shop with five packets and four
 * held has one — and showing five is how the fifth and sixth customer both get
 * told yes.
 */
export function availableToPromise(input: {
  stockOnHand: number;
  stockReserved: number;
}): number {
  return Math.max(0, input.stockOnHand - input.stockReserved);
}
