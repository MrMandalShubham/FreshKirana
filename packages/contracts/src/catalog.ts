/**
 * Catalog vocabulary (spec §2.4.1).
 *
 * Implements decision D1: a **master product** is the canonical, admin-governed
 * description of a thing you can buy; a **vendor offer** (P1.2) is one shop's
 * price and stock for it. Without that split, forty shops selling the same atta
 * produce forty search results and price comparison is impossible.
 */

export const ProductStatus = {
  /** Incomplete. Never surfaced to customers or offerable by vendors. */
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  /** Withdrawn. Existing orders keep their reference; no new offers allowed. */
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

/**
 * GST rate in basis points — 500 is 5.00%.
 *
 * Integer for the same reason money is integer paise: tax is computed,
 * apportioned and reconciled against a ledger that must balance exactly
 * (§2.11). A float rate would introduce drift at the first multiplication.
 */
export type GstRateBp = number;

export const GST_RATE_BP = {
  EXEMPT: 0,
  FIVE: 500,
  TWELVE: 1200,
  EIGHTEEN: 1800,
  TWENTY_EIGHT: 2800,
} as const;

/**
 * Common grocery GST slabs. Deliberately *not* a closed union: rates change,
 * cess exists, and §3.7.2 says confirm current rates with a CA rather than
 * hardcoding them. This is a convenience list, not the law.
 */
export const COMMON_GST_RATES_BP: readonly number[] = Object.values(GST_RATE_BP);

export function gstRateBpToPercent(bp: GstRateBp): number {
  return bp / 100;
}

export function isPlausibleGstRateBp(bp: number): boolean {
  return Number.isInteger(bp) && bp >= 0 && bp <= 5000;
}

/**
 * HSN code — 4, 6 or 8 digits. Required on every product because §3.7.1 makes
 * it a *catalog* concern, not a checkout-time lookup: the invoice cannot be
 * issued without it.
 */
export function isValidHsnCode(code: string): boolean {
  return /^\d{4}(\d{2}(\d{2})?)?$/.test(code);
}

/** EAN-8 / EAN-13 / UPC-A, digits only. Optional: regional goods often lack one. */
export function isValidEan(code: string): boolean {
  return /^\d{8}$|^\d{12,13}$/.test(code);
}

/**
 * Declarations required on pre-packaged commodities by the Legal Metrology
 * (Packaged Commodities) Rules (spec §3.7.3).
 *
 * These are a **listing** requirement, which is why they live on the master
 * product rather than being collected at order time. A pre-packaged product
 * missing any of them may not be sold.
 *
 * Loose goods — vegetables weighed at the counter — are not pre-packaged and
 * are exempt, which is what `isPrepackaged` distinguishes.
 */
export interface LegalMetrologyDeclarations {
  manufacturerPacker: string;
  countryOfOrigin: string;
  consumerCareContact: string;
}

export const LEGAL_METROLOGY_FIELDS = [
  'manufacturerPacker',
  'countryOfOrigin',
  'consumerCareContact',
] as const;

/**
 * Which declarations are missing for a product that needs them.
 * Empty array means compliant, or that the product is exempt.
 */
export function missingLegalMetrologyFields(input: {
  isPrepackaged: boolean;
  manufacturerPacker?: string | null;
  countryOfOrigin?: string | null;
  consumerCareContact?: string | null;
}): string[] {
  if (!input.isPrepackaged) return [];
  return LEGAL_METROLOGY_FIELDS.filter((field) => {
    const value = input[field];
    return value === null || value === undefined || value.trim() === '';
  });
}
