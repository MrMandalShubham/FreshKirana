/**
 * Cart vocabulary (spec §1.5.1, §4.2).
 *
 * The cart is where decision D2 becomes visible to the customer: one order is
 * fulfilled by exactly one store, so a cart belongs to one vendor. That is a
 * real constraint on the shopping experience, not an implementation detail, and
 * it has to be expressed rather than hidden.
 */

import { Uom, isDivisible } from './uom';

export const CartStatus = {
  ACTIVE: 'ACTIVE',
  /** Became an order. Kept for the funnel, never reopened. */
  CONVERTED: 'CONVERTED',
  ABANDONED: 'ABANDONED',
} as const;

export type CartStatus = (typeof CartStatus)[keyof typeof CartStatus];

/**
 * How a line's quantity is counted.
 *
 * Packaged goods are counted in packs: three 5 kg bags of atta is quantity 3.
 * Loose goods are counted in the product's own unit: 1.5 kg of tomatoes is
 * quantity 1500 with uom G. Conflating the two is how a shopper ends up
 * ordering three kilos when they wanted three hundred grams.
 */
export const QuantityMode = {
  PACKS: 'PACKS',
  MEASURE: 'MEASURE',
} as const;

export type QuantityMode = (typeof QuantityMode)[keyof typeof QuantityMode];

export function quantityModeFor(input: {
  isVariableWeight: boolean;
  uom: string;
}): QuantityMode {
  return input.isVariableWeight && isDivisible(input.uom as Uom)
    ? QuantityMode.MEASURE
    : QuantityMode.PACKS;
}

/**
 * The smallest sensible increment for a stepper.
 *
 * Loose goods step in useful amounts a shopper actually asks for — 250 g of
 * jeera, not 1 g — while packaged goods step one pack at a time.
 */
export function quantityStepFor(input: {
  isVariableWeight: boolean;
  uom: string;
}): number {
  if (quantityModeFor(input) === QuantityMode.PACKS) return 1;

  switch (input.uom as Uom) {
    case Uom.G:
      return 250;
    case Uom.KG:
      return 1;
    case Uom.ML:
      return 250;
    case Uom.L:
      return 1;
    default:
      return 1;
  }
}

/**
 * What a line costs, before any order-level fees.
 *
 * For packs it is simply price times count. For a measured line the price is
 * per the product's declared quantity, so 1500 g of a product priced at ₹40 per
 * 1000 g is ₹60 — the division has to happen in one place, exactly once, or the
 * cart and the invoice disagree.
 */
export function lineTotalPaise(input: {
  unitPricePaise: number;
  quantity: number;
  netQuantity: number;
  isVariableWeight: boolean;
  uom: string;
}): number {
  if (quantityModeFor(input) === QuantityMode.PACKS) {
    return input.unitPricePaise * input.quantity;
  }

  if (input.netQuantity <= 0) return 0;
  return Math.round((input.unitPricePaise * input.quantity) / input.netQuantity);
}

/** Order-level fees (§1.3.1). Values are configuration, never constants in code. */
export interface FeeConfig {
  /** Below this subtotal a small-basket fee applies (§1.3.1). */
  minimumOrderValuePaise: number;
  smallBasketFeePaise: number;
  /** Delivery is free at or above this subtotal. */
  freeDeliveryThresholdPaise: number;
  deliveryFeePaise: number;
  packagingFeePaise: number;
}

export interface CartTotals {
  subtotalPaise: number;
  savingsPaise: number;
  deliveryFeePaise: number;
  smallBasketFeePaise: number;
  packagingFeePaise: number;
  grandTotalPaise: number;

  /** Nudges for the §4.2 progress bars. */
  amountToFreeDeliveryPaise: number;
  amountToMinimumOrderPaise: number;
  meetsMinimumOrder: boolean;
}

export function calculateTotals(
  lines: Array<{ lineTotalPaise: number; lineMrpTotalPaise: number }>,
  fees: FeeConfig,
): CartTotals {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const mrpTotal = lines.reduce((sum, line) => sum + line.lineMrpTotalPaise, 0);

  const meetsMinimumOrder = subtotalPaise >= fees.minimumOrderValuePaise;

  // An empty basket owes nothing — there is nothing to deliver, and quoting a
  // delivery fee on an empty cart is the first number a new shopper sees.
  const deliveryFeePaise =
    subtotalPaise > 0 && subtotalPaise < fees.freeDeliveryThresholdPaise
      ? fees.deliveryFeePaise
      : 0;

  // Charged only when the basket is below the minimum, and only when there *is*
  // a basket — an empty cart owes nothing.
  const smallBasketFeePaise =
    subtotalPaise > 0 && !meetsMinimumOrder ? fees.smallBasketFeePaise : 0;

  const packagingFeePaise = subtotalPaise > 0 ? fees.packagingFeePaise : 0;

  return {
    subtotalPaise,
    savingsPaise: Math.max(0, mrpTotal - subtotalPaise),
    deliveryFeePaise,
    smallBasketFeePaise,
    packagingFeePaise,
    grandTotalPaise:
      subtotalPaise + deliveryFeePaise + smallBasketFeePaise + packagingFeePaise,

    amountToFreeDeliveryPaise: Math.max(
      0,
      fees.freeDeliveryThresholdPaise - subtotalPaise,
    ),
    amountToMinimumOrderPaise: Math.max(0, fees.minimumOrderValuePaise - subtotalPaise),
    meetsMinimumOrder,
  };
}
