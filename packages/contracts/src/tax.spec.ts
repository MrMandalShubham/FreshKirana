import { describe, expect, it } from 'vitest';
import { GST_RATE_BP } from './catalog';
import {
  formatOrderNumber,
  taxBreakdown,
  taxWithinInclusivePaise,
  taxableValuePaise,
} from './tax';

describe('extracting GST from an inclusive price', () => {
  it('takes the tax out of the price rather than adding it on', () => {
    // ₹105 at 5% contains ₹5, because ₹100 + 5% = ₹105. Adding instead of
    // extracting would give ₹5.25 and inflate every order.
    expect(taxWithinInclusivePaise(10_500, GST_RATE_BP.FIVE)).toBe(500);
    expect(taxableValuePaise(10_500, GST_RATE_BP.FIVE)).toBe(10_000);
  });

  it('handles the exempt slab', () => {
    // Unbranded staples are nil-rated, and dividing by a zero rate must not
    // produce a phantom paisa.
    expect(taxWithinInclusivePaise(25_000, GST_RATE_BP.EXEMPT)).toBe(0);
    expect(taxableValuePaise(25_000, GST_RATE_BP.EXEMPT)).toBe(25_000);
  });

  it('always sums back to the amount charged', () => {
    for (const amount of [1, 7, 99, 25_500, 123_457]) {
      for (const rate of [0, 500, 1200, 1800, 2800]) {
        expect(
          taxWithinInclusivePaise(amount, rate) + taxableValuePaise(amount, rate),
        ).toBe(amount);
      }
    }
  });

  it('ignores a non-positive amount', () => {
    expect(taxWithinInclusivePaise(0, GST_RATE_BP.FIVE)).toBe(0);
    expect(taxWithinInclusivePaise(-100, GST_RATE_BP.FIVE)).toBe(0);
  });
});

describe('taxBreakdown', () => {
  const lines = [
    { hsnCode: '1101', gstRateBp: GST_RATE_BP.FIVE, inclusivePaise: 10_500 },
    { hsnCode: '1006', gstRateBp: GST_RATE_BP.EXEMPT, inclusivePaise: 20_000 },
    { hsnCode: '1905', gstRateBp: GST_RATE_BP.EIGHTEEN, inclusivePaise: 11_800 },
    { hsnCode: '1102', gstRateBp: GST_RATE_BP.FIVE, inclusivePaise: 21_000 },
  ];

  it('groups by rate, as an invoice must show it', () => {
    const breakdown = taxBreakdown(lines);
    expect(breakdown.byRate.map((r) => r.gstRateBp)).toEqual([0, 500, 1800]);
  });

  it('sums the two 5% lines together', () => {
    const five = taxBreakdown(lines).byRate.find((r) => r.gstRateBp === 500);
    expect(five?.taxPaise).toBe(1_500);
  });

  it('reconciles against what the customer was charged', () => {
    // The control that matters: taxable value plus tax equals the total, or
    // the ledger in §2.11 will not balance.
    const breakdown = taxBreakdown(lines);
    const charged = lines.reduce((sum, l) => sum + l.inclusivePaise, 0);

    expect(breakdown.totalTaxableValuePaise + breakdown.totalTaxPaise).toBe(charged);
  });

  it('is empty for an empty basket', () => {
    expect(taxBreakdown([])).toEqual({
      byRate: [],
      totalTaxPaise: 0,
      totalTaxableValuePaise: 0,
    });
  });
});

describe('order numbers', () => {
  it('is readable over the phone', () => {
    expect(formatOrderNumber('2026-08-18', 42)).toBe('FK-260818-00042');
  });

  it('does not truncate once past five digits', () => {
    // Better a longer number than a duplicate one.
    expect(formatOrderNumber('2026-08-18', 123_456)).toBe('FK-260818-123456');
  });
});
