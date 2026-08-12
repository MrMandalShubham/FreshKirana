/**
 * Money for FreshKirana.
 *
 * All monetary values are integer **paise**. Rupee floats are never stored or
 * computed with: §1.7.1 variable-weight adjustments repeatedly multiply and
 * refund partial amounts, and §2.11 ledger postings must balance to the paise.
 * A branded type makes it a compile error to pass a raw number where money is
 * expected.
 */

declare const paiseBrand: unique symbol;

/** An integer number of paise. Construct via {@link paise} or {@link fromRupees}. */
export type Paise = number & { readonly [paiseBrand]: true };

export const ZERO = 0 as Paise;

/** Wraps an integer paise value, rejecting floats and unsafe integers. */
export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Paise must be a whole number, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise outside safe integer range: ${value}`);
  }
  return value as Paise;
}

/**
 * Converts rupees to paise, rounding half away from zero.
 *
 * Inputs are expected to be at most 2 decimal places (prices come from the
 * catalog and the UI). The epsilon nudge guards against binary representations
 * such as `1.005 * 100 === 100.49999999999999`.
 */
export function fromRupees(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`Rupee amount must be finite, received ${rupees}`);
  }
  const scaled = rupees * 100;
  const nudged =
    scaled >= 0 ? scaled + Number.EPSILON * 100 : scaled - Number.EPSILON * 100;
  return paise(Math.round(nudged));
}

/** Converts paise to a rupee number. For display and external APIs only. */
export function toRupees(amount: Paise): number {
  return amount / 100;
}

export function add(...amounts: Paise[]): Paise {
  return paise(amounts.reduce<number>((sum, a) => sum + a, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

/**
 * Scales an amount, rounding half away from zero.
 *
 * Used for variable-weight lines (§1.7.1): a 1 kg order delivered at 0.94 kg
 * charges `multiply(unitPrice, 0.94)`.
 */
export function multiply(amount: Paise, factor: number): Paise {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Factor must be finite, received ${factor}`);
  }
  const scaled = amount * factor;
  return paise(scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled));
}

/** Applies a percentage, e.g. `percentOf(order, 10)` for a 10% commission. */
export function percentOf(amount: Paise, percent: number): Paise {
  return multiply(amount, percent / 100);
}

/**
 * Splits an amount into `parts` whole-paise shares that sum exactly to the
 * original. Remainder paise are distributed one each to the leading shares, so
 * no money is created or destroyed — required for §2.11 ledger allocation.
 */
export function allocate(amount: Paise, parts: number): Paise[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(`Parts must be a positive integer, received ${parts}`);
  }
  const base = Math.trunc(amount / parts);
  let remainder = amount - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  const shares: Paise[] = [];
  for (let i = 0; i < parts; i += 1) {
    const extra = remainder !== 0 ? step : 0;
    remainder -= extra;
    shares.push(paise(base + extra));
  }
  return shares;
}

/**
 * Rounds to whole rupees, away from zero at the halfway point.
 * COD collectable amounts are rounded this way (§1.7.1) so riders handle notes
 * and coins rather than paise.
 */
export function roundToRupee(amount: Paise): Paise {
  const rupees = amount / 100;
  const rounded = rupees >= 0 ? Math.round(rupees) : -Math.round(-rupees);
  return paise(rounded * 100);
}

const INR_FORMAT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats for display with Indian digit grouping, e.g. `₹1,23,456.00`. */
export function formatINR(amount: Paise): string {
  return INR_FORMAT.format(toRupees(amount));
}

export function isZero(amount: Paise): boolean {
  return amount === 0;
}

export function isNegative(amount: Paise): boolean {
  return amount < 0;
}

export function max(a: Paise, b: Paise): Paise {
  return a >= b ? a : b;
}

export function min(a: Paise, b: Paise): Paise {
  return a <= b ? a : b;
}
