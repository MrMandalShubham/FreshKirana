/**
 * Cash-on-delivery risk and confirmation (spec §2.10.4).
 *
 * COD is the hardest operational problem in Indian e-commerce: the rider holds
 * the customer's cash, the vendor is owed the goods value, and the platform is
 * owed commission on money it never touched. An order that comes back
 * undelivered costs the goods, both legs of the delivery, and the picking time,
 * and recovers nothing.
 *
 * So a band is not a label — it decides how much certainty to buy before a shop
 * starts packing, and each step up costs the customer friction. The bands are
 * §2.10.4's; the thresholds that produce them are configuration, because a
 * pilot city tunes them weekly and a deploy per tune is a tune that never
 * happens.
 */

import { CodRiskBand } from './payment-status';

/**
 * What has to happen before a store hears about the order.
 *
 * Ordered by what it costs the customer, which is the order §2.10.4 puts them
 * in: nothing, one tap, a code they must read and type back.
 */
export const CodConfirmationMethod = {
  /** Nothing. The order goes straight to the store. */
  NONE: 'NONE',
  /** A WhatsApp message with two buttons (§2.10.4, MEDIUM). */
  QUICK_REPLY: 'QUICK_REPLY',
  /** A one-time code, where a tap is not enough (§2.10.4, HIGH). */
  OTP: 'OTP',
} as const;

export type CodConfirmationMethod =
  (typeof CodConfirmationMethod)[keyof typeof CodConfirmationMethod];

/** How a confirmation ended. Every one is audited (§2.10.4, §3.8). */
export const CodConfirmationStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  /** Nobody answered inside the window. */
  EXPIRED: 'EXPIRED',
  /** An operator decided, overriding the rules. Always attributable. */
  OVERRIDDEN: 'OVERRIDDEN',
} as const;

export type CodConfirmationStatus =
  (typeof CodConfirmationStatus)[keyof typeof CodConfirmationStatus];

/**
 * The band-to-action table from §2.10.4, as data.
 *
 * A table rather than a switch for the same reason §2.6's transitions are: the
 * mapping is a product decision people need to read, and it is auditable only
 * if it exists in one place.
 */
export const CONFIRMATION_FOR_BAND: Record<CodRiskBand, CodConfirmationMethod> = {
  [CodRiskBand.LOW]: CodConfirmationMethod.NONE,
  [CodRiskBand.MEDIUM]: CodConfirmationMethod.QUICK_REPLY,
  [CodRiskBand.HIGH]: CodConfirmationMethod.OTP,
  // Never reached: BLOCKED refuses COD at checkout rather than confirming it.
  [CodRiskBand.BLOCKED]: CodConfirmationMethod.NONE,
};

export function confirmationFor(band: CodRiskBand): CodConfirmationMethod {
  return CONFIRMATION_FOR_BAND[band] ?? CodConfirmationMethod.NONE;
}

/**
 * The knobs ops can turn without a deploy (§2.10.4).
 *
 * Every one is an integer, deliberately. A threshold that a person changes at
 * 11pm during a bad week must be impossible to get subtly wrong, and "score
 * cutoff 39.5" is a thing nobody can reason about.
 */
export interface CodThresholds {
  /** Order value above which risk starts climbing. */
  highValuePaise: number;
  veryHighValuePaise: number;
  /** Returned orders at which COD stops being offered at all. */
  rtoBlockCount: number;
  /** Score cutoffs. Each band starts at its number. */
  mediumScore: number;
  highScore: number;
  blockedScore: number;
  /** How long a customer has to answer, in minutes. */
  confirmationWindowMinutes: number;
  /** Pincodes where COD is refused outright, whatever the score. */
  blockedPincodes: readonly string[];
}

/**
 * Defaults, for a database that has never been configured.
 *
 * Deliberately conservative on the block rules and generous on the window: the
 * cost of asking one honest customer for a code is a moment of friction, and
 * the cost of a wrongly cancelled order is the order.
 */
export const DEFAULT_COD_THRESHOLDS: CodThresholds = {
  highValuePaise: 300_000,
  veryHighValuePaise: 500_000,
  rtoBlockCount: 3,
  /*
   * 25, not 20, and the gap matters.
   *
   * "First order from this account" scores exactly 20, so a cutoff at 20 makes
   * every new customer's first cash order need a confirmation — friction at the
   * precise moment §0.3 is trying to win somebody over, for a basket that is
   * usually worth less than the message costs. A first order becomes MEDIUM
   * when something *else* is also true: it is large, or there is history.
   */
  mediumScore: 25,
  highScore: 40,
  blockedScore: 70,
  // §2.10.4 says 30 minutes for the quick-reply band. Long enough that somebody
  // in a meeting still gets there, short enough that the slot is not lost.
  confirmationWindowMinutes: 30,
  blockedPincodes: [],
};

/**
 * Cutoffs must climb, or a band becomes unreachable.
 *
 * Validated rather than trusted because these are edited by hand, under
 * pressure, by somebody who is not reading this file. Silently accepting
 * `highScore < mediumScore` produces a system where nothing is ever HIGH and
 * nobody notices until the RTO number moves.
 */
export function validateThresholds(t: CodThresholds): string[] {
  const problems: string[] = [];

  if (!(t.mediumScore < t.highScore && t.highScore < t.blockedScore)) {
    problems.push(
      'Score cutoffs must increase: medium < high < blocked. ' +
        `Got ${t.mediumScore}, ${t.highScore}, ${t.blockedScore}.`,
    );
  }

  if (t.highValuePaise >= t.veryHighValuePaise) {
    problems.push('veryHighValuePaise must be greater than highValuePaise.');
  }

  if (t.confirmationWindowMinutes < 1) {
    problems.push('The confirmation window must be at least a minute.');
  }

  if (t.rtoBlockCount < 1) {
    problems.push('rtoBlockCount must be at least 1, or nobody can ever use COD.');
  }

  for (const pincode of t.blockedPincodes) {
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      problems.push(`"${pincode}" is not an Indian PIN code.`);
    }
  }

  return problems;
}

/** A code the customer reads off their phone and types back. */
export const COD_OTP_LENGTH = 6;

/**
 * Wrong guesses before a code is dead.
 *
 * Six digits is a million codes, so a handful of attempts is not a real attack
 * surface — but the account is the customer's own order, and the thing being
 * defended is a delivery, not a bank balance. Five is enough to survive
 * fat fingers and few enough to make guessing pointless.
 */
export const COD_OTP_MAX_ATTEMPTS = 5;
