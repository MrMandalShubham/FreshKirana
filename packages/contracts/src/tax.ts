/**
 * GST arithmetic (spec §3.7.1, §5.2).
 *
 * ## Prices in India include tax
 *
 * The MRP printed on a packet is what the customer pays, tax included. So GST
 * is **extracted** from a line total, never added to it. Getting this backwards
 * inflates every order by the tax rate and is not visible until a customer
 * compares the app's total against the printed price.
 *
 * The invoice itself is P5.2. This file is the arithmetic underneath it, kept
 * here so cart, checkout and invoicing cannot each round differently.
 */

/**
 * The tax inside a GST-inclusive amount.
 *
 * For a rate of r basis points, an inclusive amount A contains
 * `A × r / (10000 + r)` of tax — not `A × r / 10000`, which is the tax on top
 * of A.
 *
 * ₹105 at 5% contains ₹5.00, because ₹100 + 5% = ₹105.
 */
export function taxWithinInclusivePaise(
  inclusivePaise: number,
  gstRateBp: number,
): number {
  if (gstRateBp <= 0 || inclusivePaise <= 0) return 0;
  return Math.round((inclusivePaise * gstRateBp) / (10_000 + gstRateBp));
}

/** What is left after the tax comes out. Always sums back to the total. */
export function taxableValuePaise(inclusivePaise: number, gstRateBp: number): number {
  return inclusivePaise - taxWithinInclusivePaise(inclusivePaise, gstRateBp);
}

export interface TaxLine {
  hsnCode: string;
  gstRateBp: number;
  inclusivePaise: number;
}

export interface TaxBreakdown {
  /** Tax per rate, because an invoice must show each slab separately. */
  byRate: Array<{
    gstRateBp: number;
    taxableValuePaise: number;
    taxPaise: number;
  }>;
  totalTaxPaise: number;
  totalTaxableValuePaise: number;
}

/**
 * Groups lines by GST rate, as a tax invoice must show them.
 *
 * Rounding happens **per line**, then sums — not on the grouped total. A
 * grocery basket mixes 0%, 5% and 18% goods, and the sum of rounded lines is
 * the number that has to match what the customer was charged.
 */
export function taxBreakdown(lines: readonly TaxLine[]): TaxBreakdown {
  const byRate = new Map<number, { taxableValuePaise: number; taxPaise: number }>();

  for (const line of lines) {
    const tax = taxWithinInclusivePaise(line.inclusivePaise, line.gstRateBp);
    const existing = byRate.get(line.gstRateBp) ?? { taxableValuePaise: 0, taxPaise: 0 };

    existing.taxPaise += tax;
    existing.taxableValuePaise += line.inclusivePaise - tax;
    byRate.set(line.gstRateBp, existing);
  }

  const rows = [...byRate.entries()]
    .map(([gstRateBp, totals]) => ({ gstRateBp, ...totals }))
    .sort((a, b) => a.gstRateBp - b.gstRateBp);

  return {
    byRate: rows,
    totalTaxPaise: rows.reduce((sum, row) => sum + row.taxPaise, 0),
    totalTaxableValuePaise: rows.reduce((sum, row) => sum + row.taxableValuePaise, 0),
  };
}

/**
 * A human-readable order number.
 *
 * People read this over the phone, write it on a packing slip and search for it
 * in WhatsApp. `FK-260818-00042` survives all three; a UUID survives none of
 * them. The date makes a support call navigable without a lookup, and the
 * sequence is what actually guarantees uniqueness.
 */
export function formatOrderNumber(dateKey: string, sequence: number): string {
  const compactDate = dateKey.slice(2).replaceAll('-', '');
  return `FK-${compactDate}-${String(sequence).padStart(5, '0')}`;
}
