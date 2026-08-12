/**
 * Units of measure (spec §1.1, §2.4.1).
 *
 * Grocery is unit-native: a product is "5 kg", not "1 item". Quantity steppers,
 * per-unit price display (₹/kg) and variable-weight pricing all key off this.
 */

export const Uom = {
  KG: 'KG',
  G: 'G',
  L: 'L',
  ML: 'ML',
  PIECE: 'PIECE',
  DOZEN: 'DOZEN',
  PACK: 'PACK',
} as const;

export type Uom = (typeof Uom)[keyof typeof Uom];

/** Unit a variable-weight product is priced in (spec §1.7.1). */
export const PricingUom = {
  PER_KG: 'PER_KG',
  PER_100G: 'PER_100G',
  PER_L: 'PER_L',
  PER_PIECE: 'PER_PIECE',
} as const;

export type PricingUom = (typeof PricingUom)[keyof typeof PricingUom];

/** Default tolerance band for variable-weight lines, in percent (§1.7.1). */
export const DEFAULT_WEIGHT_TOLERANCE_PCT = 10;

/** Whether a unit supports fractional quantities. */
export function isDivisible(uom: Uom): boolean {
  return uom === Uom.KG || uom === Uom.G || uom === Uom.L || uom === Uom.ML;
}

/** Short display suffix, e.g. `500 g`. */
export const UOM_LABEL: Record<Uom, string> = {
  KG: 'kg',
  G: 'g',
  L: 'L',
  ML: 'ml',
  PIECE: 'pc',
  DOZEN: 'dozen',
  PACK: 'pack',
};

/** Vegetarian marking required on Indian food listings (§2.4.1). */
export const VegMark = {
  VEG: 'VEG',
  NON_VEG: 'NON_VEG',
  EGG: 'EGG',
} as const;

export type VegMark = (typeof VegMark)[keyof typeof VegMark];

/** Vendor inventory accuracy tier (spec §1.9.2). */
export const InventoryMode = {
  TOGGLE: 'TOGGLE',
  THRESHOLD: 'THRESHOLD',
  QUANTITY: 'QUANTITY',
} as const;

export type InventoryMode = (typeof InventoryMode)[keyof typeof InventoryMode];

/** Only QUANTITY-mode offers participate in reservations (§2.5). */
export function supportsReservation(mode: InventoryMode): boolean {
  return mode === InventoryMode.QUANTITY;
}
