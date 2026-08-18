import { describe, expect, it } from 'vitest';
import {
  type FeeConfig,
  QuantityMode,
  calculateTotals,
  lineTotalPaise,
  quantityModeFor,
  quantityStepFor,
} from './cart';
import { Uom } from './uom';

const fees: FeeConfig = {
  minimumOrderValuePaise: 25000, // ₹250
  smallBasketFeePaise: 2000, // ₹20
  freeDeliveryThresholdPaise: 50000, // ₹500
  deliveryFeePaise: 2500, // ₹25
  packagingFeePaise: 500, // ₹5
};

describe('quantityModeFor', () => {
  it('counts packaged goods in packs', () => {
    expect(quantityModeFor({ isVariableWeight: false, uom: Uom.KG })).toBe(
      QuantityMode.PACKS,
    );
    expect(quantityModeFor({ isVariableWeight: false, uom: Uom.PIECE })).toBe(
      QuantityMode.PACKS,
    );
  });

  it('counts loose goods by measure', () => {
    expect(quantityModeFor({ isVariableWeight: true, uom: Uom.G })).toBe(
      QuantityMode.MEASURE,
    );
  });

  it('counts a variable-weight but indivisible unit in packs', () => {
    // A coconut sold "by weight" is still bought one at a time.
    expect(quantityModeFor({ isVariableWeight: true, uom: Uom.PIECE })).toBe(
      QuantityMode.PACKS,
    );
  });
});

describe('quantityStepFor', () => {
  it('steps packaged goods one pack at a time', () => {
    expect(quantityStepFor({ isVariableWeight: false, uom: Uom.KG })).toBe(1);
  });

  it('steps loose goods in amounts a shopper actually asks for', () => {
    // 250 g of jeera, not 1 g.
    expect(quantityStepFor({ isVariableWeight: true, uom: Uom.G })).toBe(250);
    expect(quantityStepFor({ isVariableWeight: true, uom: Uom.ML })).toBe(250);
  });
});

describe('lineTotalPaise', () => {
  it('multiplies price by pack count', () => {
    // Three 5 kg bags at ₹255 each.
    expect(
      lineTotalPaise({
        unitPricePaise: 25500,
        quantity: 3,
        netQuantity: 5,
        isVariableWeight: false,
        uom: Uom.KG,
      }),
    ).toBe(76500);
  });

  it('scales a measured line by the declared quantity', () => {
    // ₹40 per 1000 g, 1500 g requested, so ₹60.
    expect(
      lineTotalPaise({
        unitPricePaise: 4000,
        quantity: 1500,
        netQuantity: 1000,
        isVariableWeight: true,
        uom: Uom.G,
      }),
    ).toBe(6000);
  });

  it('rounds a measured line to whole paise', () => {
    // ₹33.33 per 1000 g, 250 g requested.
    const total = lineTotalPaise({
      unitPricePaise: 3333,
      quantity: 250,
      netQuantity: 1000,
      isVariableWeight: true,
      uom: Uom.G,
    });
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(833);
  });

  it('refuses to divide by a nonsensical declared quantity', () => {
    expect(
      lineTotalPaise({
        unitPricePaise: 4000,
        quantity: 500,
        netQuantity: 0,
        isVariableWeight: true,
        uom: Uom.G,
      }),
    ).toBe(0);
  });
});

describe('calculateTotals', () => {
  const line = (total: number, mrp = total) => ({
    lineTotalPaise: total,
    lineMrpTotalPaise: mrp,
  });

  it('charges nothing on an empty cart', () => {
    const totals = calculateTotals([], fees);
    expect(totals.grandTotalPaise).toBe(0);
    expect(totals.deliveryFeePaise).toBe(0);
    expect(totals.smallBasketFeePaise).toBe(0);
    expect(totals.packagingFeePaise).toBe(0);
  });

  it('charges the small-basket fee below the minimum order value', () => {
    const totals = calculateTotals([line(10000)], fees);
    expect(totals.meetsMinimumOrder).toBe(false);
    expect(totals.smallBasketFeePaise).toBe(2000);
    expect(totals.amountToMinimumOrderPaise).toBe(15000);
  });

  it('drops the small-basket fee once the minimum is met', () => {
    const totals = calculateTotals([line(25000)], fees);
    expect(totals.meetsMinimumOrder).toBe(true);
    expect(totals.smallBasketFeePaise).toBe(0);
  });

  it('waives delivery at the free-delivery threshold', () => {
    expect(calculateTotals([line(49900)], fees).deliveryFeePaise).toBe(2500);
    expect(calculateTotals([line(50000)], fees).deliveryFeePaise).toBe(0);
  });

  it('reports how far the basket is from free delivery', () => {
    // The §4.2 progress bar depends on this being exact, not approximate.
    expect(calculateTotals([line(42000)], fees).amountToFreeDeliveryPaise).toBe(8000);
    expect(calculateTotals([line(60000)], fees).amountToFreeDeliveryPaise).toBe(0);
  });

  it('sums savings against MRP', () => {
    const totals = calculateTotals([line(25500, 28000), line(19000, 20000)], fees);
    expect(totals.savingsPaise).toBe(3500);
  });

  it('never reports negative savings when a price exceeds its MRP', () => {
    // The offer constraint forbids this, but the total must not go strange if
    // stale data ever slips through.
    expect(calculateTotals([line(30000, 28000)], fees).savingsPaise).toBe(0);
  });

  it('adds up to the paisa', () => {
    const totals = calculateTotals([line(30000), line(12345)], fees);
    expect(totals.subtotalPaise).toBe(42345);
    expect(totals.grandTotalPaise).toBe(
      totals.subtotalPaise +
        totals.deliveryFeePaise +
        totals.smallBasketFeePaise +
        totals.packagingFeePaise,
    );
    expect(Number.isInteger(totals.grandTotalPaise)).toBe(true);
  });
});
