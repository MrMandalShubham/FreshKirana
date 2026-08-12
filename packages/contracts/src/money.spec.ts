import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  allocate,
  formatINR,
  fromRupees,
  multiply,
  paise,
  percentOf,
  roundToRupee,
  subtract,
  toRupees,
} from './money';

describe('paise', () => {
  it('accepts whole numbers', () => {
    expect(paise(60000)).toBe(60000);
    expect(paise(0)).toBe(0);
    expect(paise(-500)).toBe(-500);
  });

  it('rejects fractional paise', () => {
    expect(() => paise(10.5)).toThrow(RangeError);
  });

  it('rejects unsafe integers', () => {
    expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('fromRupees', () => {
  it('converts whole and decimal rupees', () => {
    expect(fromRupees(600)).toBe(60000);
    expect(fromRupees(19.99)).toBe(1999);
    expect(fromRupees(0.05)).toBe(5);
  });

  it('handles binary representation edge cases', () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE-754
    expect(fromRupees(1.005)).toBe(101);
    expect(fromRupees(8.115)).toBe(812);
  });

  it('rejects non-finite input', () => {
    expect(() => fromRupees(Number.NaN)).toThrow(RangeError);
    expect(() => fromRupees(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(fromRupees(600), fromRupees(25), fromRupees(5))).toBe(63000);
    expect(subtract(fromRupees(600), fromRupees(60))).toBe(54000);
  });

  it('sums an empty list to zero', () => {
    expect(add()).toBe(ZERO);
  });

  it('never accumulates float drift across many additions', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in paise this must be exact.
    const tenPaise = fromRupees(0.1);
    let total = ZERO;
    for (let i = 0; i < 1000; i += 1) {
      total = add(total, tenPaise);
    }
    expect(total).toBe(fromRupees(100));
  });
});

describe('multiply - variable weight (§1.7.1)', () => {
  it('scales a 1 kg line down to the delivered weight', () => {
    const pricePerKg = fromRupees(40);
    expect(multiply(pricePerKg, 0.94)).toBe(3760);
    expect(formatINR(multiply(pricePerKg, 0.94))).toBe('₹37.60');
  });

  it('rounds half away from zero in both directions', () => {
    expect(multiply(paise(101), 0.5)).toBe(51);
    expect(multiply(paise(-101), 0.5)).toBe(-51);
  });

  it('rejects non-finite factors', () => {
    expect(() => multiply(fromRupees(40), Number.NaN)).toThrow(RangeError);
  });
});

describe('percentOf', () => {
  it('computes commission', () => {
    expect(percentOf(fromRupees(600), 10)).toBe(6000);
    expect(percentOf(fromRupees(637.5), 8)).toBe(5100);
  });
});

describe('allocate', () => {
  it('splits evenly when divisible', () => {
    expect(allocate(fromRupees(9), 3)).toEqual([300, 300, 300]);
  });

  it('distributes remainder paise without losing money', () => {
    const shares = allocate(paise(100), 3);
    expect(shares).toEqual([34, 33, 33]);
    expect(add(...shares)).toBe(100);
  });

  it('preserves the total for negative amounts', () => {
    const shares = allocate(paise(-100), 3);
    expect(add(...shares)).toBe(-100);
  });

  it('rejects invalid part counts', () => {
    expect(() => allocate(paise(100), 0)).toThrow(RangeError);
    expect(() => allocate(paise(100), 1.5)).toThrow(RangeError);
  });
});

describe('roundToRupee - COD collectable (§1.7.1)', () => {
  it('rounds to whole rupees away from zero', () => {
    expect(roundToRupee(paise(63749))).toBe(63700);
    expect(roundToRupee(paise(63750))).toBe(63800);
    expect(roundToRupee(paise(-63750))).toBe(-63800);
  });
});

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(fromRupees(123456))).toBe('₹1,23,456.00');
    expect(formatINR(fromRupees(600))).toBe('₹600.00');
  });
});

describe('toRupees', () => {
  it('round-trips through fromRupees', () => {
    expect(toRupees(fromRupees(1234.56))).toBe(1234.56);
  });
});
