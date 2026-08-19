/**
 * The three §2.17.2 interfaces, and the heuristics behind them (rule R3).
 *
 * ## Why these exist now, with no AI behind them
 *
 * §2.17 is explicit: the cost of keeping the door open is these three
 * interfaces, and swapping a model in later should be a binding change rather
 * than a refactor. So they are declared here in the shared package, in terms of
 * plain data — no module types, no database rows — and each module ships a rule
 * implementation behind its own.
 *
 * ## And why the usual basket is not one of the AI things
 *
 * §2.17.1, guardrail 1: *"Your usual basket is **not AI** — it is a SQL query,
 * and it is the §0.3 wedge. It must not be filed under 'AI, do later.' Doing so
 * launches FreshKirana as a generic marketplace."*
 *
 * The heuristic is item frequency × median repurchase interval. That is the
 * whole model, and it is enough: somebody who buys atta every three weeks and
 * last bought it twenty-four days ago needs atta.
 */

// ---------------------------------------------------------------------------
// §2.17.2 — the interfaces
// ---------------------------------------------------------------------------

export interface PredictedBasketItem {
  masterProductId: string;
  /** How much of it, in the product's own unit — packs or grams. */
  quantity: number;
  /** Times bought. One purchase is a purchase; two is a habit. */
  purchaseCount: number;
  /** Typical gap between purchases, in days. Null until bought twice. */
  medianIntervalDays: number | null;
  daysSinceLastPurchase: number;
  /** 0–1. What we would stake on this being wanted right now. */
  confidence: number;
}

export interface PredictedBasket {
  accountId: string;
  items: PredictedBasketItem[];
  /** Which implementation produced this, so analytics can compare them. */
  strategy: string;
}

/** §2.17.2. Implemented today by a SQL heuristic; a model later. */
export interface BasketPredictor {
  predict(accountId: string): Promise<PredictedBasket>;
}

export interface SubstituteCandidate {
  vendorOfferId: string;
  masterProductId: string;
  name: string;
  netQuantity: number;
  uom: string;
  sellingPricePaise: number;
  /** 0–1. How good a stand-in this is for what was ordered. */
  score: number;
  /** Why it was offered, in words a picker or a customer can read. */
  reason: string;
}

export interface SubstituteContext {
  /** The line that cannot be filled. */
  masterProductId: string;
  vendorId: string;
  quantity: number;
}

/** §2.17.2. Rules today; an LLM once §2.17.3's acceptance-rate trigger fires. */
export interface SubstituteRanker {
  rank(context: SubstituteContext): Promise<SubstituteCandidate[]>;
}

export interface RiskInput {
  accountId: string;
  orderTotalPaise: number;
  paymentMethod: string;
  /** Orders this account has completed. New accounts are the risk (§2.10.4). */
  completedOrderCount: number;
  /** Orders that came back undelivered. The signal that actually matters. */
  rtoCount: number;
  addressPincode: string;
}

export interface RiskAssessment {
  band: string;
  score: number;
  /** Every rule that fired, because §3.8 requires the decision be auditable. */
  reasons: string[];
}

/** §2.17.2. Deterministic rules — §2.17.1 prefers them here, and so does §3.8. */
export interface RiskScorer {
  score(input: RiskInput): Promise<RiskAssessment>;
}

// ---------------------------------------------------------------------------
// The usual-basket heuristic (§0.3, §2.17.1)
// ---------------------------------------------------------------------------

/** A purchase of one product, as the SQL returns it. */
export interface PurchaseRecord {
  masterProductId: string;
  /** When the order was placed, oldest first. */
  purchasedAt: Date;
  quantity: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The middle gap between purchases, in days.
 *
 * Median rather than mean, deliberately. One holiday, one bulk buy before a
 * festival, one month away — any of those drags an average far enough to make
 * the prediction useless, and grocery histories are full of them. The median
 * shrugs them off.
 *
 * Null on a single purchase: there is no interval yet, and inventing one would
 * mean predicting a habit from a single act.
 */
export function medianIntervalDays(purchasedAt: readonly Date[]): number | null {
  if (purchasedAt.length < 2) return null;

  const sorted = [...purchasedAt].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];

  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / DAY_MS);
  }

  return median(gaps);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * How overdue a repurchase is. 1 means "due today".
 *
 * Capped at 3 so a product bought twice a year ago cannot outrank the weekly
 * atta simply by being enormously overdue — at some point "overdue" stops
 * meaning "wanted" and starts meaning "they stopped buying it".
 */
export function dueness(
  daysSinceLastPurchase: number,
  medianDays: number | null,
): number {
  if (medianDays === null || medianDays <= 0) return 0;
  return Math.min(3, daysSinceLastPurchase / medianDays);
}

/**
 * Confidence that this is wanted now.
 *
 * Two things multiply: how established the habit is, and how due it is. A
 * weekly purchase that is a day early scores lower than the same purchase two
 * days late, and a thing bought twice ever never scores as highly as a thing
 * bought ten times.
 */
export function repurchaseConfidence(input: {
  purchaseCount: number;
  daysSinceLastPurchase: number;
  medianIntervalDays: number | null;
}): number {
  // Two purchases is the floor for a habit; ten is as convinced as this gets.
  const habit = Math.min(1, Math.max(0, (input.purchaseCount - 1) / 9));

  const due = dueness(input.daysSinceLastPurchase, input.medianIntervalDays);
  // Peaks around the expected day and falls away on both sides: too early is
  // as wrong as far too late.
  const timing = due === 0 ? 0 : Math.max(0, 1 - Math.abs(1 - due));

  return round2(habit * 0.5 + timing * 0.5);
}

export interface UsualBasketOptions {
  /** Below this, an item is not in the basket. Tuned, not guessed at. */
  minConfidence?: number;
  /** How many items to offer. A basket of forty is not one tap. */
  limit?: number;
  /** Purchases at least this many times. One purchase is not a habit. */
  minPurchases?: number;
}

export const USUAL_BASKET_DEFAULTS: Required<UsualBasketOptions> = {
  minConfidence: 0.25,
  limit: 12,
  minPurchases: 2,
};

/**
 * Turns a purchase history into a predicted basket.
 *
 * Pure, so the §0.3 wedge is testable without a database — the part of this
 * system most likely to be tuned should be the easiest thing to experiment
 * with.
 */
export function predictUsualBasket(
  purchases: readonly PurchaseRecord[],
  now: Date,
  options: UsualBasketOptions = {},
): PredictedBasketItem[] {
  const config = { ...USUAL_BASKET_DEFAULTS, ...options };

  const byProduct = new Map<string, PurchaseRecord[]>();
  for (const purchase of purchases) {
    const existing = byProduct.get(purchase.masterProductId);
    if (existing) existing.push(purchase);
    else byProduct.set(purchase.masterProductId, [purchase]);
  }

  const items: PredictedBasketItem[] = [];

  for (const [masterProductId, records] of byProduct) {
    if (records.length < config.minPurchases) continue;

    const dates = records.map((r) => r.purchasedAt);
    const lastPurchase = Math.max(...dates.map((d) => d.getTime()));
    const daysSinceLastPurchase = (now.getTime() - lastPurchase) / DAY_MS;
    const interval = medianIntervalDays(dates);

    const confidence = repurchaseConfidence({
      purchaseCount: records.length,
      daysSinceLastPurchase,
      medianIntervalDays: interval,
    });

    if (confidence < config.minConfidence) continue;

    items.push({
      masterProductId,
      // The usual amount, not the last amount: one unusual week should not
      // redefine what "usual" means.
      quantity: Math.max(1, Math.round(median(records.map((r) => r.quantity)))),
      purchaseCount: records.length,
      medianIntervalDays: interval === null ? null : round2(interval),
      daysSinceLastPurchase: round2(daysSinceLastPurchase),
      confidence,
    });
  }

  return items
    .sort((a, b) => b.confidence - a.confidence || b.purchaseCount - a.purchaseCount)
    .slice(0, config.limit);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
