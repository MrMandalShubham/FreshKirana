import { describe, expect, it } from 'vitest';
import { SubstitutionPreference } from './order-status';
import {
  SIZE_TOLERANCE,
  TIMEOUT_FALLBACK,
  priceSubstitution,
  refuseSubstitution,
} from './substitutions';
import { VegMark } from './uom';

const base = {
  categoryId: 'cat-staples',
  netQuantity: 1,
  uom: 'kg',
  vegMark: VegMark.VEG,
  isVariableWeight: false,
};

const swap = (
  original: Partial<typeof base>,
  candidate: Partial<typeof base>,
): string | null =>
  refuseSubstitution({
    original: { ...base, ...original },
    candidate: { ...base, ...candidate },
  });

describe('what may never be substituted (§1.7.2)', () => {
  it('allows a same-size, same-category swap', () => {
    expect(swap({}, {})).toBeNull();
  });

  it('refuses a different category', () => {
    // Nobody accepts rice for oil.
    expect(swap({}, { categoryId: 'cat-oils' })).toBe('A different kind of product');
  });

  it('never sends meat in place of a vegetarian product', () => {
    // Not a bad match — a harm, and in much of India a serious one.
    expect(swap({ vegMark: VegMark.VEG }, { vegMark: VegMark.NON_VEG })).toBe(
      'A different dietary marking',
    );
  });

  it('never sends a vegetarian product in place of meat either', () => {
    // Symmetric on purpose: somebody who ordered chicken did not order paneer.
    expect(swap({ vegMark: VegMark.NON_VEG }, { vegMark: VegMark.VEG })).toBe(
      'A different dietary marking',
    );
  });

  it('treats egg as its own marking', () => {
    // Plenty of vegetarians eat neither, so EGG cannot stand in for VEG.
    expect(swap({ vegMark: VegMark.VEG }, { vegMark: VegMark.EGG })).toBe(
      'A different dietary marking',
    );
  });

  it('refuses a packaged substitute for a loose item', () => {
    // Somebody who ordered loose tomatoes chose to have them weighed, and the
    // §1.7.1 weight flow only knows how to price one of the two.
    expect(swap({ isVariableWeight: true }, { isVariableWeight: false })).toBe(
      'Loose and packaged are not interchangeable',
    );
  });

  it('refuses a loose substitute for a packaged item', () => {
    expect(swap({ isVariableWeight: false }, { isVariableWeight: true })).toBe(
      'Loose and packaged are not interchangeable',
    );
  });

  it('refuses a different unit of measure', () => {
    expect(swap({ uom: 'kg' }, { uom: 'l' })).toBe('Measured differently');
  });

  it('accepts a size just inside the ±25% band', () => {
    expect(swap({ netQuantity: 1 }, { netQuantity: 1 + SIZE_TOLERANCE })).toBeNull();
    expect(swap({ netQuantity: 1 }, { netQuantity: 1 - SIZE_TOLERANCE })).toBeNull();
  });

  it('refuses a size outside it', () => {
    // §1.7.2 says ±25%. A 2 kg pack for a 1 kg order is not the same purchase,
    // whatever the category says.
    expect(swap({ netQuantity: 1 }, { netQuantity: 2 })).toBe('Too different in size');
    expect(swap({ netQuantity: 1 }, { netQuantity: 0.5 })).toBe('Too different in size');
  });

  it('says why, rather than returning a bare no', () => {
    // A picker standing in an aisle deserves to know why the obvious swap is
    // not offered; "no suggestions" is how people learn to work around us.
    const reason = swap({}, { categoryId: 'other' });
    expect(reason).toBeTruthy();
    expect(reason!.length).toBeGreaterThan(5);
  });
});

describe('what the swap costs (§1.7.2)', () => {
  it('charges less, and refunds the difference, when the substitute is cheaper', () => {
    const outcome = priceSubstitution(10_000, 8_000);

    expect(outcome.chargePaise).toBe(8_000);
    expect(outcome.refundPaise).toBe(2_000);
    expect(outcome.needsConsent).toBe(false);
  });

  it('never charges more than the original without consent', () => {
    // The rule the spec states outright. Charging somebody more for an item
    // they did not choose, because a shop ran out, is indefensible however
    // small the amount.
    const outcome = priceSubstitution(10_000, 12_000);

    expect(outcome.chargePaise).toBe(10_000);
    expect(outcome.needsConsent).toBe(true);
  });

  it('charges the higher price once the customer has agreed to it', () => {
    const outcome = priceSubstitution(10_000, 12_000, true);

    expect(outcome.chargePaise).toBe(12_000);
    expect(outcome.needsConsent).toBe(false);
  });

  it('charges the same and refunds nothing when the prices match', () => {
    const outcome = priceSubstitution(10_000, 10_000);

    expect(outcome).toEqual({
      chargePaise: 10_000,
      refundPaise: 0,
      needsConsent: false,
    });
  });

  it('never produces a negative refund', () => {
    expect(priceSubstitution(10_000, 12_000).refundPaise).toBe(0);
  });
});

describe('when nobody answers', () => {
  it('falls back to a refund, not to the saved preference', () => {
    // Somebody who chose ASK_ME asked to be asked. Treating their silence as
    // "go ahead" is exactly what they opted out of, and a refund is the only
    // fallback that cannot deliver something unwanted.
    expect(TIMEOUT_FALLBACK).toBe(SubstitutionPreference.REFUND_ITEM);
  });
});
