import { describe, expect, it } from 'vitest';
import { Uom, isDivisible, pricePerBaseUnit, supportsReservation } from './uom';
import { InventoryMode } from './uom';

describe('pricePerBaseUnit', () => {
  it('converts a multi-kilo pack to a per-kilo price', () => {
    // ₹250 for 5 kg is ₹50/kg.
    expect(pricePerBaseUnit(25000, 5, Uom.KG)).toEqual({
      pricePaise: 5000,
      unit: Uom.KG,
    });
  });

  it('converts grams to a per-kilo price', () => {
    // ₹60 for 500 g is ₹120/kg.
    expect(pricePerBaseUnit(6000, 500, Uom.G)).toEqual({
      pricePaise: 12000,
      unit: Uom.KG,
    });
  });

  it('converts millilitres to a per-litre price', () => {
    expect(pricePerBaseUnit(9900, 900, Uom.ML)).toEqual({
      pricePaise: 11000,
      unit: Uom.L,
    });
  });

  it('exposes the shrinkflation comparison it exists for', () => {
    // A 900 ml pack at ₹99 looks cheaper than 1 L at ₹105, until per-litre.
    const smaller = pricePerBaseUnit(9900, 900, Uom.ML)!;
    const larger = pricePerBaseUnit(10500, 1, Uom.L)!;
    expect(smaller.pricePaise).toBeGreaterThan(larger.pricePaise);
  });

  it('returns null for counted goods, where it would just repeat the price', () => {
    expect(pricePerBaseUnit(2000, 1, Uom.PIECE)).toBeNull();
    expect(pricePerBaseUnit(2000, 12, Uom.DOZEN)).toBeNull();
    expect(pricePerBaseUnit(2000, 1, Uom.PACK)).toBeNull();
  });

  it('refuses nonsensical quantities rather than dividing by zero', () => {
    expect(pricePerBaseUnit(2000, 0, Uom.KG)).toBeNull();
    expect(pricePerBaseUnit(2000, -5, Uom.KG)).toBeNull();
  });
});

describe('unit helpers', () => {
  it('knows which units take fractional quantities', () => {
    expect(isDivisible(Uom.KG)).toBe(true);
    expect(isDivisible(Uom.ML)).toBe(true);
    expect(isDivisible(Uom.PIECE)).toBe(false);
  });

  it('reserves stock only for vendors keeping true counts', () => {
    expect(supportsReservation(InventoryMode.QUANTITY)).toBe(true);
    expect(supportsReservation(InventoryMode.TOGGLE)).toBe(false);
    expect(supportsReservation(InventoryMode.THRESHOLD)).toBe(false);
  });
});
