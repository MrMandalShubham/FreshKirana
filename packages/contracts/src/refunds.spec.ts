import { describe, expect, it } from 'vitest';
import { OrderStatus } from './order-status';
import { PaymentMethod } from './payment-status';
import {
  RefundRoute,
  cancellationFeePaise,
  etaFor,
  isFullyRefunded,
  refundableAmountPaise,
  routeFor,
} from './refunds';

describe('where the money goes (§1.8.2)', () => {
  it('sends prepaid money back the way it came', () => {
    // Refunding a card payment to a bank account trips money-laundering
    // controls, and is not what the customer expects either.
    expect(routeFor(PaymentMethod.UPI_INTENT)).toBe(RefundRoute.ORIGINAL_METHOD);
    expect(routeFor(PaymentMethod.CARD)).toBe(RefundRoute.ORIGINAL_METHOD);
  });

  it('ignores a store-credit preference on a prepaid order', () => {
    // There is a rail to reverse, so it gets reversed. Store credit exists for
    // cash, where there is nothing to reverse.
    expect(routeFor(PaymentMethod.UPI_INTENT, true)).toBe(RefundRoute.ORIGINAL_METHOD);
  });

  it('defaults a cash refund to a bank transfer, not store credit', () => {
    // §1.8.2: store credit is opt-in only. "We kept your money as credit" is
    // how a refund becomes a complaint, and a stored-value instrument the
    // customer did not choose has RBI implications.
    expect(routeFor(PaymentMethod.COD)).toBe(RefundRoute.BANK_TRANSFER);
  });

  it('honours store credit when the customer asked for it', () => {
    expect(routeFor(PaymentMethod.COD, true)).toBe(RefundRoute.STORE_CREDIT);
  });
});

describe('what the customer is told to expect', () => {
  it('gives a range rather than a date', () => {
    // The gateway controls the timing and routinely takes the long end. A
    // precise date is a promise this system cannot keep.
    const eta = etaFor(RefundRoute.ORIGINAL_METHOD);
    expect(eta.maxDays).toBeGreaterThan(eta.minDays);
  });

  it('is fastest for the one route we control end to end', () => {
    expect(etaFor(RefundRoute.STORE_CREDIT).maxDays).toBeLessThan(
      etaFor(RefundRoute.BANK_TRANSFER).maxDays,
    );
  });
});

describe('the cancellation fee (§1.8.1)', () => {
  it('is nothing by default', () => {
    // V1 charges no fee. The mechanism exists so a pilot city can change that
    // without a code change.
    expect(cancellationFeePaise(OrderStatus.PACKED, 0)).toBe(0);
  });

  it('is not charged before anybody has done work', () => {
    expect(cancellationFeePaise(OrderStatus.AWAITING_VENDOR, 5_000)).toBe(0);
    expect(cancellationFeePaise(OrderStatus.ACCEPTED, 5_000)).toBe(0);
    expect(cancellationFeePaise(OrderStatus.PICKING, 5_000)).toBe(0);
  });

  it('is charged once the shop has packed it', () => {
    // §1.8.1 allows cancelling here "with a warning" — the work is done and
    // wasted, which is exactly what a fee would be for.
    expect(cancellationFeePaise(OrderStatus.PACKED, 5_000)).toBe(5_000);
    expect(cancellationFeePaise(OrderStatus.READY_FOR_PICKUP, 5_000)).toBe(5_000);
  });
});

describe('how much goes back', () => {
  it('returns the whole amount when nothing was refunded before', () => {
    expect(refundableAmountPaise(50_000, 0)).toBe(50_000);
  });

  it('returns only what is left after an earlier partial refund', () => {
    expect(refundableAmountPaise(50_000, 20_000)).toBe(30_000);
  });

  it('takes the fee off the top', () => {
    expect(refundableAmountPaise(50_000, 0, 5_000)).toBe(45_000);
  });

  it('never goes negative', () => {
    // The paid amount and the fee come from different places, and a negative
    // refund is a charge — the most expensive possible arithmetic mistake.
    expect(refundableAmountPaise(1_000, 0, 5_000)).toBe(0);
    expect(refundableAmountPaise(50_000, 60_000)).toBe(0);
  });
});

describe('when an order counts as fully refunded (§2.6.2)', () => {
  it('is true once everything taken has gone back', () => {
    expect(isFullyRefunded(50_000, 50_000)).toBe(true);
  });

  it('is false while any part is still held', () => {
    expect(isFullyRefunded(50_000, 49_999)).toBe(false);
  });

  it('is false for an order that was never paid', () => {
    // A cash order nobody collected is not "fully refunded" — there is nothing
    // to refund, and calling it refunded would put a lie in the ledger.
    expect(isFullyRefunded(0, 0)).toBe(false);
  });
});
