import { describe, expect, it } from 'vitest';
import {
  ACTIVE_RESERVATION_STATUSES,
  RESERVATION_TTL_MINUTES,
  ReservationStatus,
  availableToPromise,
  hasExpired,
  holdsStock,
  modeReserves,
  reservationExpiresAt,
  reservationTtlMinutes,
} from './inventory';
import { InventoryMode } from './uom';

describe('what still holds stock', () => {
  it('counts held and confirmed', () => {
    expect(holdsStock(ReservationStatus.HELD)).toBe(true);
    expect(holdsStock(ReservationStatus.CONFIRMED)).toBe(true);
  });

  it('does not count released or consumed', () => {
    // Both are endings, and deliberately different ones: released stock went
    // back on the shelf, consumed stock left the building.
    expect(holdsStock(ReservationStatus.RELEASED)).toBe(false);
    expect(holdsStock(ReservationStatus.CONSUMED)).toBe(false);
  });

  it('agrees with the list the queries use', () => {
    for (const status of Object.values(ReservationStatus)) {
      expect(holdsStock(status)).toBe(
        (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(status),
      );
    }
  });
});

describe('who reserves (§1.9.2)', () => {
  it('reserves only in quantity mode', () => {
    expect(modeReserves(InventoryMode.QUANTITY)).toBe(true);
  });

  it('leaves toggle and threshold alone', () => {
    // Not a failure — §1.9.2's deliberate trade. A shop keeping no counts
    // accepts a higher substitution rate instead, and refusing its orders
    // would exclude most shops on day one.
    expect(modeReserves(InventoryMode.TOGGLE)).toBe(false);
    expect(modeReserves(InventoryMode.THRESHOLD)).toBe(false);
  });
});

describe('time to live (§2.5)', () => {
  it('gives prepaid ten minutes for UPI collect', () => {
    expect(reservationTtlMinutes('UPI_COLLECT')).toBe(RESERVATION_TTL_MINUTES.PREPAID);
  });

  it('gives COD fifteen, because a person has to answer', () => {
    expect(reservationTtlMinutes('COD')).toBe(
      RESERVATION_TTL_MINUTES.COD_WITH_CONFIRMATION,
    );
  });

  it('computes the expiry', () => {
    const from = new Date('2026-08-19T10:00:00Z');
    expect(reservationExpiresAt(from, 10).toISOString()).toBe('2026-08-19T10:10:00.000Z');
  });

  it('expires at the moment, not a moment later', () => {
    const at = new Date('2026-08-19T10:10:00Z');
    expect(hasExpired(at, at)).toBe(true);
    expect(hasExpired(at, new Date('2026-08-19T10:09:59Z'))).toBe(false);
  });

  it('never expires a confirmed hold', () => {
    // Confirmed reservations carry no expiry: the money is settled, and a
    // sweeper releasing that stock would leave an order nobody can pack.
    expect(hasExpired(null, new Date())).toBe(false);
  });
});

describe('available to promise', () => {
  it('subtracts what is already held', () => {
    // Five packets with four held is one. Showing five is how the fifth and
    // sixth customer both get told yes.
    expect(availableToPromise({ stockOnHand: 5, stockReserved: 4 })).toBe(1);
  });

  it('never goes negative', () => {
    expect(availableToPromise({ stockOnHand: 2, stockReserved: 5 })).toBe(0);
  });
});
