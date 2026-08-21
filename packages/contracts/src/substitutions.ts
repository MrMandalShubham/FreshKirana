/**
 * Substitutions (spec §1.7.2).
 *
 * Five to fifteen per cent of lines go out of stock between order and picking.
 * Without substitution every one of those becomes a cancellation, so this is
 * not a nicety — it is the difference between a shop that can serve a basket
 * and one that can only serve a perfect basket.
 *
 * It is also the feature with the most ways to make somebody genuinely angry:
 * charging more than they agreed, sending meat to a vegetarian household, or
 * swapping loose tomatoes for a sealed pack. The rules below exist to make
 * those unrepresentable rather than unlikely.
 */

import { SubstitutionPreference } from './order-status';
import { VegMark } from './uom';

/** What happened to a proposal (§1.7.2). */
export const SubstitutionStatus = {
  /** Waiting on the customer. Only ASK_ME ever reaches this. */
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  /** Nobody answered inside the window; the fallback applied. */
  TIMED_OUT: 'TIMED_OUT',
  /** Applied without asking, under AUTO_SUBSTITUTE. */
  AUTO_APPLIED: 'AUTO_APPLIED',
  /** The customer wanted the money back instead (REFUND_ITEM). */
  REFUNDED: 'REFUNDED',
} as const;

export type SubstitutionStatus =
  (typeof SubstitutionStatus)[keyof typeof SubstitutionStatus];

/**
 * How long a customer has to answer (§1.7.2).
 *
 * Ten minutes, and the spec is specific about it. Long enough for somebody to
 * notice a message and reply; short enough that a picker is not standing in an
 * aisle with a half-filled crate. When it lapses the order does not stall —
 * §1.7.2 falls back to a refund, which is the answer that cannot be wrong.
 */
export const SUBSTITUTION_WINDOW_MINUTES = 10;

/**
 * What a timeout means.
 *
 * Deliberately *not* the customer's saved preference. Somebody who chose
 * ASK_ME asked to be asked; treating their silence as "go ahead" is precisely
 * the thing they opted out of. Refunding the line is the only fallback that
 * cannot deliver something unwanted.
 */
export const TIMEOUT_FALLBACK: SubstitutionPreference =
  SubstitutionPreference.REFUND_ITEM;

/** How many options a customer is offered (§1.7.2: two to three). */
export const MAX_SUBSTITUTE_OPTIONS = 3;

/** The size band a substitute must fall inside (§1.7.2: ±25%). */
export const SIZE_TOLERANCE = 0.25;

export interface SubstituteSafetyInput {
  /** What was ordered. */
  original: {
    categoryId: string;
    netQuantity: number;
    uom: string;
    vegMark: string;
    isVariableWeight: boolean;
  };
  candidate: {
    categoryId: string;
    netQuantity: number;
    uom: string;
    vegMark: string;
    isVariableWeight: boolean;
  };
}

/**
 * Whether this substitution is allowed at all (§1.7.2).
 *
 * Returns the reason it is refused rather than a bare boolean, because a picker
 * standing in an aisle deserves to know why the obvious swap is not offered —
 * and because "no suggestions" with no explanation is how people learn to work
 * around the system.
 *
 * Every rule here is a hard refusal, never a score. A low-scoring substitute is
 * a worse match; a non-veg substitute for a veg product is a different kind of
 * mistake entirely, and no amount of similarity elsewhere should be able to
 * outweigh it.
 */
export function refuseSubstitution(input: SubstituteSafetyInput): string | null {
  const { original, candidate } = input;

  if (original.categoryId !== candidate.categoryId) {
    return 'A different kind of product';
  }

  /*
   * Diet is not negotiable.
   *
   * A vegetarian household receiving meat is not a bad substitution, it is a
   * harm — and in much of India it is a serious one. The rule is symmetric and
   * absolute: the marking must match exactly. Egg is its own category for the
   * same reason, since plenty of vegetarians eat neither.
   */
  if (original.vegMark !== candidate.vegMark) {
    return 'A different dietary marking';
  }

  /*
   * Loose and packaged are different purchases.
   *
   * Somebody who ordered a kilo of loose tomatoes chose them to be weighed;
   * somebody who ordered a sealed pack chose the pack. Swapping either way also
   * breaks the §1.7.1 weight flow, which only knows how to price one of them.
   */
  if (original.isVariableWeight !== candidate.isVariableWeight) {
    return 'Loose and packaged are not interchangeable';
  }

  if (original.uom !== candidate.uom) {
    return 'Measured differently';
  }

  const ratio =
    original.netQuantity > 0 ? candidate.netQuantity / original.netQuantity : 0;

  if (ratio < 1 - SIZE_TOLERANCE || ratio > 1 + SIZE_TOLERANCE) {
    return 'Too different in size';
  }

  return null;
}

export interface PriceOutcome {
  /** What the customer is charged for the substituted line. */
  chargePaise: number;
  /** Owed back, when the substitute is cheaper. Never negative. */
  refundPaise: number;
  /** True when the substitute costs more and consent is required. */
  needsConsent: boolean;
}

/**
 * What the swap costs (§1.7.2).
 *
 * The rule the spec states outright: **never charge more than the original**
 * without explicit consent, and refund the difference when the substitute is
 * cheaper. So a dearer substitute is not simply blocked — it is offered at the
 * original price unless the customer agreed to the higher one, which is what
 * "explicit consent" buys.
 *
 * Charging a customer more than they agreed, for an item they did not choose,
 * because a shop ran out of something, is indefensible however small the
 * amount. Absorbing the difference is cheaper than the complaint.
 */
export function priceSubstitution(
  originalLineTotalPaise: number,
  substituteLineTotalPaise: number,
  consented = false,
): PriceOutcome {
  if (substituteLineTotalPaise > originalLineTotalPaise) {
    return consented
      ? { chargePaise: substituteLineTotalPaise, refundPaise: 0, needsConsent: false }
      : // Held at what they agreed to. The shop and the platform split the
        // difference through settlement (§2.11), not the customer.
        { chargePaise: originalLineTotalPaise, refundPaise: 0, needsConsent: true };
  }

  return {
    chargePaise: substituteLineTotalPaise,
    refundPaise: originalLineTotalPaise - substituteLineTotalPaise,
    needsConsent: false,
  };
}

/** Whether a marking is one a substitution may cross. It never is. */
export function isDietaryMatch(a: string, b: string): boolean {
  return a === b && (Object.values(VegMark) as string[]).includes(a);
}
