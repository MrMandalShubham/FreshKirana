import { describe, expect, it } from 'vitest';
import {
  BatchStatus,
  byExpiryFirst,
  daysRemaining,
  hasEnoughShelfLife,
  isPickable,
} from './perishables';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day('2026-06-01');

describe('how much life is left', () => {
  it('counts whole days', () => {
    expect(daysRemaining(day('2026-06-11'), TODAY)).toBe(10);
  });

  it('calls a batch expiring later today zero, not a fraction', () => {
    // Rounding up would put food hours from expiry into somebody's basket.
    const laterToday = new Date('2026-06-01T20:00:00.000Z');
    expect(daysRemaining(laterToday, TODAY)).toBe(0);
  });

  it('goes negative once expired', () => {
    expect(daysRemaining(day('2026-05-30'), TODAY)).toBe(-2);
  });
});

describe('minimum shelf life on delivery (§1.7.3)', () => {
  it('accepts a batch with most of its life left', () => {
    // Made 1 June, expires 1 July, and today is the day it was made.
    expect(
      hasEnoughShelfLife({ mfgDate: TODAY, expiryDate: day('2026-07-01') }, TODAY, 30),
    ).toBe(true);
  });

  it('refuses a batch below the threshold', () => {
    // 30-day life, 6 days left: 20%, under the 30% floor.
    expect(
      hasEnoughShelfLife(
        { mfgDate: day('2026-05-08'), expiryDate: day('2026-06-07') },
        TODAY,
        30,
      ),
    ).toBe(false);
  });

  it('refuses anything already expired', () => {
    expect(
      hasEnoughShelfLife(
        { mfgDate: day('2026-05-01'), expiryDate: day('2026-05-31') },
        TODAY,
      ),
    ).toBe(false);
  });

  it('refuses a batch expiring today', () => {
    expect(
      hasEnoughShelfLife({ mfgDate: day('2026-05-01'), expiryDate: TODAY }, TODAY),
    ).toBe(false);
  });

  it('judges by proportion, not by days', () => {
    // Two days left means opposite things for paneer and for atta, which is the
    // whole reason §1.7.3 states the rule as a percentage.
    const paneer = { mfgDate: day('2026-05-30'), expiryDate: day('2026-06-05') };
    const atta = { mfgDate: day('2025-06-01'), expiryDate: day('2026-06-03') };

    expect(hasEnoughShelfLife(paneer, TODAY, 30)).toBe(true);
    expect(hasEnoughShelfLife(atta, TODAY, 30)).toBe(false);
  });

  it('falls back to "not expired" when there is no manufacture date', () => {
    // Loose produce has an expiry and no meaningful start. Refusing to stock it
    // because a field is null is the wrong answer to a modelling gap.
    expect(
      hasEnoughShelfLife({ mfgDate: null, expiryDate: day('2026-06-03') }, TODAY),
    ).toBe(true);
    expect(
      hasEnoughShelfLife({ mfgDate: null, expiryDate: day('2026-05-30') }, TODAY),
    ).toBe(false);
  });

  it('honours a stricter threshold', () => {
    const batch = { mfgDate: day('2026-05-22'), expiryDate: day('2026-06-11') };

    expect(hasEnoughShelfLife(batch, TODAY, 30)).toBe(true);
    expect(hasEnoughShelfLife(batch, TODAY, 80)).toBe(false);
  });
});

describe('first expiry, first out (§1.7.3)', () => {
  it('puts the soonest expiry first', () => {
    const sorted = byExpiryFirst([
      { batchNo: 'B2', expiryDate: day('2026-06-20') },
      { batchNo: 'B1', expiryDate: day('2026-06-05') },
      { batchNo: 'B3', expiryDate: day('2026-06-12') },
    ]);

    expect(sorted.map((b) => b.batchNo)).toEqual(['B1', 'B3', 'B2']);
  });

  it('puts batches with no expiry last, not first', () => {
    // Sorting null as zero would float every non-perishable to the top of the
    // picking list, which is the opposite of what FEFO is for.
    const sorted = byExpiryFirst([
      { batchNo: 'RICE', expiryDate: null },
      { batchNo: 'MILK', expiryDate: day('2026-06-02') },
    ]);

    expect(sorted.map((b) => b.batchNo)).toEqual(['MILK', 'RICE']);
  });

  it('breaks ties on batch number, so the order is stable', () => {
    // A picking list that reshuffles between refreshes is one nobody trusts.
    const same = day('2026-06-10');
    const sorted = byExpiryFirst([
      { batchNo: 'B9', expiryDate: same },
      { batchNo: 'B1', expiryDate: same },
    ]);

    expect(sorted.map((b) => b.batchNo)).toEqual(['B1', 'B9']);
  });

  it('does not mutate what it was given', () => {
    const batches = [
      { batchNo: 'B2', expiryDate: day('2026-06-20') },
      { batchNo: 'B1', expiryDate: day('2026-06-05') },
    ];

    byExpiryFirst(batches);
    expect(batches[0]!.batchNo).toBe('B2');
  });
});

describe('what may be picked', () => {
  it('allows only an active batch', () => {
    expect(isPickable(BatchStatus.ACTIVE)).toBe(true);
  });

  it('refuses a recalled batch', () => {
    // The one that matters: a recalled lot must never reach another customer.
    expect(isPickable(BatchStatus.RECALLED)).toBe(false);
  });

  it('refuses a delisted or depleted batch', () => {
    expect(isPickable(BatchStatus.DELISTED)).toBe(false);
    expect(isPickable(BatchStatus.DEPLETED)).toBe(false);
  });
});
