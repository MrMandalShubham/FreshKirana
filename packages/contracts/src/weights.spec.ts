import { describe, expect, it } from 'vitest';
import {
  MIN_REFUND_PAISE,
  authorisationCeilingPaise,
  codCollectablePaise,
  isOutsideTolerance,
  kgToGrams,
  priceByWeight,
  weighLine,
} from './weights';

/** ₹100 per kg, the price of most things this is used for. */
const PER_KG = 10_000;

describe('pricing what was actually delivered (§1.7.1)', () => {
  it('charges for the weight on the scale, not the weight ordered', () => {
    // The whole point of the part. 0.94 kg of tomatoes is ₹94, not ₹100.
    expect(priceByWeight(kgToGrams(0.94), PER_KG)).toBe(9_400);
  });

  it('charges more when the picker packs more', () => {
    expect(priceByWeight(kgToGrams(1.06), PER_KG)).toBe(10_600);
  });

  it('rounds to whole paise', () => {
    // 333 g at ₹100/kg is 3,330 paise exactly; 334 g is 3,340. A fraction of a
    // paise is not payable, and carrying it makes an invoice that does not add.
    expect(priceByWeight(333, PER_KG)).toBe(3_330);
    expect(Number.isInteger(priceByWeight(337, 9_990))).toBe(true);
  });
});

describe('the tolerance band (§1.7.1)', () => {
  it('accepts a small shortfall', () => {
    expect(isOutsideTolerance(kgToGrams(1), kgToGrams(0.94), 10)).toBe(false);
  });

  it('accepts a small excess', () => {
    expect(isOutsideTolerance(kgToGrams(1), kgToGrams(1.06), 10)).toBe(false);
  });

  it('flags a large excess, even though the customer pays for it', () => {
    // 1.3 kg against a 1 kg order is not a windfall, it is not what they chose
    // — and they are being asked to pay 30% more than they agreed.
    expect(isOutsideTolerance(kgToGrams(1), kgToGrams(1.3), 10)).toBe(true);
  });

  it('flags a large shortfall too', () => {
    expect(isOutsideTolerance(kgToGrams(1), kgToGrams(0.7), 10)).toBe(true);
  });

  it('is symmetric at the boundary', () => {
    // Exactly ±10% is inside; a gram beyond is not.
    expect(isOutsideTolerance(1_000, 1_100, 10)).toBe(false);
    expect(isOutsideTolerance(1_000, 900, 10)).toBe(false);
    expect(isOutsideTolerance(1_000, 1_101, 10)).toBe(true);
    expect(isOutsideTolerance(1_000, 899, 10)).toBe(true);
  });

  it('honours a product with a wider band than the default', () => {
    // A whole fish does not weigh what a bag of tomatoes weighs.
    expect(isOutsideTolerance(kgToGrams(1), kgToGrams(1.2), 25)).toBe(false);
  });
});

describe('what to authorise before anything is weighed', () => {
  it('holds the top of the band, not the estimate', () => {
    // §1.7.1 step 1: authorise estimate × (1 + tolerance), so a heavier pack
    // can still be captured without going back to the customer.
    expect(authorisationCeilingPaise(10_000, 10)).toBe(11_000);
  });
});

describe('what happens when a line is weighed', () => {
  it('owes the customer money when the pack came in light', () => {
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: kgToGrams(0.9),
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    expect(outcome.actualLineTotalPaise).toBe(9_000);
    expect(outcome.deltaPaise).toBe(1_000);
    expect(outcome.absorbed).toBe(false);
  });

  it('charges the customer more when the pack came in heavy', () => {
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: kgToGrams(1.08),
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    // Negative means they owe, and the sign is the only thing carrying that.
    expect(outcome.deltaPaise).toBe(-800);
  });

  it('absorbs a refund too small to be worth issuing', () => {
    // §1.7.1: below ₹5. A gateway refund costs a fee, takes days, and makes a
    // bank line somebody reconciles — for less than one tomato.
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: kgToGrams(0.98),
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    expect(outcome.deltaPaise).toBe(200);
    expect(outcome.deltaPaise).toBeLessThan(MIN_REFUND_PAISE);
    expect(outcome.absorbed).toBe(true);
  });

  it('never absorbs money the customer owes us', () => {
    // Absorbing in that direction would be charging somebody quietly, which is
    // the opposite of the rule.
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: kgToGrams(1.02),
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    expect(outcome.deltaPaise).toBeLessThan(0);
    expect(outcome.absorbed).toBe(false);
  });

  it('says when consent is needed, separately from the money', () => {
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: kgToGrams(1.3),
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    expect(outcome.outsideTolerance).toBe(true);
    expect(outcome.actualLineTotalPaise).toBe(13_000);
  });

  it('charges nothing for a line that weighed nothing', () => {
    const outcome = weighLine({
      orderedGrams: kgToGrams(1),
      actualGrams: 0,
      pricePerKgPaise: PER_KG,
      tolerancePct: 10,
    });

    expect(outcome.actualLineTotalPaise).toBe(0);
    expect(outcome.deltaPaise).toBe(10_000);
  });
});

describe('what the rider collects (§1.7.1)', () => {
  it('rounds to a whole rupee', () => {
    // A rider and a customer settling 47 paise at a doorstep is a fiction —
    // there is no coin for it and both of them know it.
    expect(codCollectablePaise(9_447)).toBe(9_400);
    expect(codCollectablePaise(9_451)).toBe(9_500);
  });

  it('rounds a half-rupee down, in the customer’s favour', () => {
    expect(codCollectablePaise(9_450)).toBe(9_400);
  });

  it('leaves a whole rupee alone', () => {
    expect(codCollectablePaise(9_400)).toBe(9_400);
  });

  it('always returns a whole number of rupees', () => {
    for (const amount of [1, 99, 100, 12_345, 99_999]) {
      expect(codCollectablePaise(amount) % 100).toBe(0);
    }
  });
});
