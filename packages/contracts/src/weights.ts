/**
 * Variable-weight goods (spec §1.7.1).
 *
 * Loose vegetables, fruit, meat and cut dairy are *ordered by intent* — "1 kg
 * tomatoes" — and *delivered by actual weight* — 0.94 kg. That gap is the whole
 * problem: it touches pricing, payment, invoicing and the cash a rider
 * collects, and getting it wrong means charging somebody for food they did not
 * receive.
 *
 * The rule underneath every function here: **the customer pays for what was
 * delivered**. Not the estimate, not the rounded-up estimate, not the estimate
 * when the difference is small. What is on the scale.
 */

import { DEFAULT_WEIGHT_TOLERANCE_PCT } from './uom';

/**
 * Weights are integer grams, like money is integer paise.
 *
 * A scale reads 0.94 kg and a float would store 0.9400000000000001. Grams are
 * exact, they are what Indian shop scales display anyway, and 1 g of resolution
 * is finer than any of them.
 */
export type Grams = number;

export const GRAMS_PER_KG = 1_000;

/**
 * Refunds smaller than this are absorbed rather than issued (§1.7.1).
 *
 * Five rupees. A gateway refund costs a fee, takes days to arrive, and produces
 * a bank line item somebody has to reconcile — for less than the price of a
 * single tomato. Absorbing it is cheaper for the platform *and* better for the
 * customer, which is a rare combination and worth taking.
 *
 * The direction matters: this only ever means the customer keeps money we could
 * have collected, never the reverse.
 */
export const MIN_REFUND_PAISE = 500;

export interface WeighedLine {
  /** What the customer ordered, in grams. */
  orderedGrams: Grams;
  /** What the scale said. */
  actualGrams: Grams;
  /** Price per `pricing_uom`, in paise — normally per kilogram. */
  pricePerKgPaise: number;
  /** The product's own band. §1.7.1 defaults to ±10%. */
  tolerancePct: number;
}

export interface WeighedOutcome {
  /** What this line now costs, priced on the actual weight. */
  actualLineTotalPaise: number;
  /** What it cost before weighing, for comparison. */
  estimatedLineTotalPaise: number;
  /**
   * Positive when the customer is owed money, negative when they owe more.
   *
   * Signed on purpose. An unsigned "difference" plus a separate direction flag
   * is two things to get right instead of one, and the failure mode is
   * refunding somebody who should have been charged.
   */
  deltaPaise: number;
  /** True when the actual weight fell outside the product's band (§1.7.1). */
  outsideTolerance: boolean;
  /** True when a refund is owed but too small to be worth issuing. */
  absorbed: boolean;
}

/**
 * What a weighed line costs.
 *
 * Rounded to the nearest paise, because a fraction of a paise is not a thing
 * anybody can pay or refund, and carrying it forward makes an invoice that does
 * not add up.
 */
export function priceByWeight(actualGrams: Grams, pricePerKgPaise: number): number {
  return Math.round((actualGrams * pricePerKgPaise) / GRAMS_PER_KG);
}

/**
 * Whether the scale reading is inside the band the customer was shown.
 *
 * Symmetric: 1.3 kg against a 1 kg order is as much a surprise as 0.7 kg, even
 * though one costs the customer more and the other less. §1.7.1 requires
 * consent for either, because both mean they are not getting what they chose.
 */
export function isOutsideTolerance(
  orderedGrams: Grams,
  actualGrams: Grams,
  tolerancePct: number = DEFAULT_WEIGHT_TOLERANCE_PCT,
): boolean {
  if (orderedGrams <= 0) return true;

  const drift = Math.abs(actualGrams - orderedGrams) / orderedGrams;
  return drift > tolerancePct / 100;
}

/** The upper bound to authorise at checkout (§1.7.1 prepaid step 1). */
export function authorisationCeilingPaise(
  estimateePaise: number,
  tolerancePct: number = DEFAULT_WEIGHT_TOLERANCE_PCT,
): number {
  return Math.round(estimateePaise * (1 + tolerancePct / 100));
}

/**
 * Everything that follows from putting a line on a scale.
 *
 * One function rather than several, because the answers have to agree: what to
 * charge, what to refund, and whether to ask first are the same decision seen
 * from three sides, and computing them apart is how they drift.
 */
export function weighLine(input: WeighedLine): WeighedOutcome {
  const estimatedLineTotalPaise = priceByWeight(
    input.orderedGrams,
    input.pricePerKgPaise,
  );
  const actualLineTotalPaise = priceByWeight(input.actualGrams, input.pricePerKgPaise);

  const deltaPaise = estimatedLineTotalPaise - actualLineTotalPaise;

  // Only a refund can be absorbed. Money the customer owes is never quietly
  // written off *against* them — that would be a charge nobody agreed to.
  const absorbed = deltaPaise > 0 && deltaPaise < MIN_REFUND_PAISE;

  return {
    actualLineTotalPaise,
    estimatedLineTotalPaise,
    deltaPaise,
    outsideTolerance: isOutsideTolerance(
      input.orderedGrams,
      input.actualGrams,
      input.tolerancePct,
    ),
    absorbed,
  };
}

/**
 * What the rider collects, rounded (§1.7.1).
 *
 * To the nearest rupee, because a rider and a customer settling 47 paise at a
 * doorstep is a fiction — there is no coin for it, and both of them know it.
 * Rounding *down* on the half so the customer never pays more than the goods,
 * which is the same principle as absorbing a small refund.
 */
export function codCollectablePaise(totalPaise: number): number {
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  return (paise > 50 ? rupees + 1 : rupees) * 100;
}

/** Grams, from what a shop scale shows. Accepts "0.94" and "940". */
export function kgToGrams(kg: number): Grams {
  return Math.round(kg * GRAMS_PER_KG);
}

export function gramsToKg(grams: Grams): number {
  return grams / GRAMS_PER_KG;
}
