/**
 * Perishables, batches and recall (spec §1.7.3).
 *
 * Groceries go off. That single fact drives three requirements that have
 * nothing to do with each other mechanically and everything to do with each
 * other in practice:
 *
 * - **FEFO** — sell the oldest stock first, or it becomes waste.
 * - **Minimum shelf life** — do not deliver milk that expires tomorrow.
 * - **Recall** — when something is unsafe, find everyone who got it.
 *
 * The third is why batches exist at all. Without a batch on the order line,
 * "which customers received the contaminated lot?" has no answer, and FSSAI
 * compliance is not a report you can assemble afterwards from prices and dates.
 */

/**
 * How much life a batch must have left when it reaches the customer.
 *
 * §1.7.3 defaults to 30% of total shelf life. As a *fraction* rather than a
 * fixed number of days, because shelf life is not one thing: a day-old paneer
 * with two days left is fine, and a year-long packet of atta with two days left
 * is not — the same two days mean opposite things.
 */
export const DEFAULT_MIN_SHELF_LIFE_PCT = 30;

/** What a batch may still be used for. */
export const BatchStatus = {
  /** Sellable and pickable. */
  ACTIVE: 'ACTIVE',
  /** Too short-dated to deliver (§1.7.3). Still physically present. */
  DELISTED: 'DELISTED',
  /** Withdrawn on safety grounds. Must never be picked again. */
  RECALLED: 'RECALLED',
  /** Sold through, or thrown away. */
  DEPLETED: 'DEPLETED',
} as const;

export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];

/** Where a recall stands (§1.7.3). */
export const RecallStatus = {
  /** Sale blocked, affected orders being identified. */
  OPEN: 'OPEN',
  /** Everyone who received it has been told. */
  NOTIFIED: 'NOTIFIED',
  CLOSED: 'CLOSED',
} as const;

export type RecallStatus = (typeof RecallStatus)[keyof typeof RecallStatus];

/**
 * Why a batch was withdrawn.
 *
 * Recorded because a regulator-ready report has to say, and because "we pulled
 * it" and "the manufacturer pulled it" are different conversations with
 * different liability (§1.8.4).
 */
export const RecallReason = {
  /** Ours, or the store's, on inspection. */
  QUALITY: 'QUALITY',
  /** The manufacturer or a regulator withdrew the lot. */
  MANUFACTURER: 'MANUFACTURER',
  REGULATORY: 'REGULATORY',
  CONTAMINATION: 'CONTAMINATION',
  MISLABELLED: 'MISLABELLED',
} as const;

export type RecallReason = (typeof RecallReason)[keyof typeof RecallReason];

export interface ShelfLife {
  /** When the batch was made. Null for produce with no manufacture date. */
  mfgDate: Date | null;
  expiryDate: Date;
}

/**
 * Days of life left on a given day.
 *
 * Whole days, and *floor*: a batch expiring later today has zero days left, not
 * a fraction of one. Rounding up here would put food a few hours from expiry
 * into somebody's basket.
 */
export function daysRemaining(expiryDate: Date, on: Date): number {
  const ms = expiryDate.getTime() - on.getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Whether a batch has enough life left to deliver (§1.7.3).
 *
 * With no manufacture date there is no total to take a percentage of, so the
 * rule degrades to "not expired" — produce sold loose has an expiry and no
 * meaningful start, and refusing to stock it because a field is null would be
 * the wrong answer to a modelling gap.
 */
export function hasEnoughShelfLife(
  batch: ShelfLife,
  on: Date,
  minPct: number = DEFAULT_MIN_SHELF_LIFE_PCT,
): boolean {
  const left = daysRemaining(batch.expiryDate, on);
  if (left <= 0) return false;

  if (!batch.mfgDate) return true;

  const totalDays = daysRemaining(batch.expiryDate, batch.mfgDate);
  if (totalDays <= 0) return false;

  return (left / totalDays) * 100 >= minPct;
}

/**
 * First expiry, first out (§1.7.3).
 *
 * The oldest stock is sold first or it becomes waste, which is the single
 * largest controllable cost in fresh grocery. Ties break on batch number so the
 * order is stable — a picking list that reshuffles between refreshes is a
 * picking list somebody stops trusting.
 */
export function byExpiryFirst<T extends { expiryDate: Date | null; batchNo: string }>(
  batches: readonly T[],
): T[] {
  return [...batches].sort((a, b) => {
    // A batch with no expiry is not urgent, so it goes last rather than first —
    // sorting null as zero would put non-perishables at the top of every list.
    if (!a.expiryDate && !b.expiryDate) return a.batchNo.localeCompare(b.batchNo);
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;

    const byDate = a.expiryDate.getTime() - b.expiryDate.getTime();
    return byDate !== 0 ? byDate : a.batchNo.localeCompare(b.batchNo);
  });
}

/** Whether a batch may be picked at all. */
export function isPickable(status: string): boolean {
  return status === BatchStatus.ACTIVE;
}
