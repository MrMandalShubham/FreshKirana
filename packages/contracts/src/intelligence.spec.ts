import { describe, expect, it } from 'vitest';
import {
  type PurchaseRecord,
  USUAL_BASKET_DEFAULTS,
  dueness,
  median,
  medianIntervalDays,
  predictUsualBasket,
  repurchaseConfidence,
} from './intelligence';

const NOW = new Date('2026-08-19T06:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const bought = (
  masterProductId: string,
  agoDays: number[],
  quantity = 1,
): PurchaseRecord[] =>
  agoDays.map((days) => ({ masterProductId, purchasedAt: daysAgo(days), quantity }));

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([7, 1, 3])).toBe(3);
  });

  it('averages the middle two of an even list', () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it('is zero for nothing', () => {
    expect(median([])).toBe(0);
  });
});

describe('median repurchase interval', () => {
  it('needs two purchases before there is an interval', () => {
    // One purchase is a purchase, not a habit. Inventing an interval here
    // would mean predicting a rhythm from a single act.
    expect(medianIntervalDays([daysAgo(3)])).toBeNull();
    expect(medianIntervalDays([])).toBeNull();
  });

  it('finds a weekly rhythm', () => {
    expect(medianIntervalDays([daysAgo(21), daysAgo(14), daysAgo(7)])).toBe(7);
  });

  it('ignores the order the dates arrive in', () => {
    expect(medianIntervalDays([daysAgo(7), daysAgo(21), daysAgo(14)])).toBe(7);
  });

  it('shrugs off a holiday', () => {
    // Weekly atta, then a month away, then weekly again. The mean gap would be
    // 11 days and predict badly for the rest of the year; the median stays 7.
    const dates = [
      daysAgo(70),
      daysAgo(63),
      daysAgo(56),
      daysAgo(21), // back from a month away
      daysAgo(14),
      daysAgo(7),
    ];

    expect(medianIntervalDays(dates)).toBe(7);
  });
});

describe('dueness', () => {
  it('is 1 on the expected day', () => {
    expect(dueness(7, 7)).toBe(1);
  });

  it('is below 1 when it is early', () => {
    expect(dueness(3, 7)).toBeCloseTo(0.43, 2);
  });

  it('is capped, so an abandoned product cannot dominate', () => {
    // Bought twice, two years ago. Enormously overdue, and no longer wanted —
    // at some point "overdue" stops meaning "wanted".
    expect(dueness(730, 7)).toBe(3);
  });

  it('is zero without an interval', () => {
    expect(dueness(10, null)).toBe(0);
  });
});

describe('repurchase confidence', () => {
  it('rises with an established habit', () => {
    const occasional = repurchaseConfidence({
      purchaseCount: 2,
      daysSinceLastPurchase: 7,
      medianIntervalDays: 7,
    });
    const regular = repurchaseConfidence({
      purchaseCount: 10,
      daysSinceLastPurchase: 7,
      medianIntervalDays: 7,
    });

    expect(regular).toBeGreaterThan(occasional);
  });

  it('treats far too early as no better than late', () => {
    const barelyBought = repurchaseConfidence({
      purchaseCount: 6,
      daysSinceLastPurchase: 1,
      medianIntervalDays: 30,
    });
    const dueNow = repurchaseConfidence({
      purchaseCount: 6,
      daysSinceLastPurchase: 30,
      medianIntervalDays: 30,
    });

    expect(dueNow).toBeGreaterThan(barelyBought);
  });

  it('never exceeds 1', () => {
    expect(
      repurchaseConfidence({
        purchaseCount: 100,
        daysSinceLastPurchase: 7,
        medianIntervalDays: 7,
      }),
    ).toBeLessThanOrEqual(1);
  });
});

describe('the usual basket (§0.3)', () => {
  it('offers what is bought repeatedly and due now', () => {
    const purchases = [...bought('atta', [21, 14, 7], 2), ...bought('rice', [30, 15], 1)];

    const basket = predictUsualBasket(purchases, NOW);
    expect(basket.map((i) => i.masterProductId)).toContain('atta');
  });

  it('ignores something bought once', () => {
    // A one-off is not a habit, and putting it in the basket every week is how
    // a shopper learns to stop trusting the list.
    const basket = predictUsualBasket(bought('birthday-cake', [40]), NOW);
    expect(basket).toEqual([]);
  });

  it('uses the usual quantity, not the last one', () => {
    // Two packs most weeks, six once for a party. The basket should say two.
    const purchases = [
      { masterProductId: 'atta', purchasedAt: daysAgo(21), quantity: 2 },
      { masterProductId: 'atta', purchasedAt: daysAgo(14), quantity: 2 },
      { masterProductId: 'atta', purchasedAt: daysAgo(7), quantity: 6 },
    ];

    expect(predictUsualBasket(purchases, NOW)[0]?.quantity).toBe(2);
  });

  it('ranks the thing that is due above the thing that is not', () => {
    const purchases = [
      // Weekly, and a day overdue.
      ...bought('atta', [24, 16, 8]),
      // Monthly, bought two days ago — not wanted yet.
      ...bought('oil', [62, 32, 2]),
    ];

    const basket = predictUsualBasket(purchases, NOW);
    expect(basket[0]?.masterProductId).toBe('atta');
  });

  it('stays short enough to be one tap', () => {
    const purchases = Array.from({ length: 40 }, (_, index) =>
      bought(`product-${index}`, [21, 14, 7]),
    ).flat();

    expect(predictUsualBasket(purchases, NOW)).toHaveLength(USUAL_BASKET_DEFAULTS.limit);
  });

  it('reports its working, so the list can be explained', () => {
    // "You buy this about every 7 days and it has been 8" is a reason a person
    // accepts. A bare list is something they have to check item by item.
    const item = predictUsualBasket(bought('atta', [22, 15, 8]), NOW)[0];

    expect(item?.purchaseCount).toBe(3);
    expect(item?.medianIntervalDays).toBe(7);
    expect(item?.daysSinceLastPurchase).toBeCloseTo(8, 0);
  });

  it('drops what somebody has clearly stopped buying', () => {
    // Weekly for a while, then nothing for a year.
    const purchases = bought('discontinued', [400, 393, 386]);
    expect(predictUsualBasket(purchases, NOW)).toEqual([]);
  });

  it('has nothing to say about a new customer', () => {
    expect(predictUsualBasket([], NOW)).toEqual([]);
  });
});
