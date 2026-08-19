/**
 * Search vocabulary (spec §2.7).
 *
 * Indian grocery search is unusually hard: the same product is `atta`, `aata`
 * or `आटा`; onion is `kanda`, `pyaz` or `dungri` depending on where you are;
 * and shoppers type from memory, not from packaging. The engine matters far
 * less than the language handling, which is why everything here is
 * engine-independent.
 */

/** Why a result matched, surfaced so ranking decisions stay debuggable. */
export const MatchReason = {
  EXACT: 'EXACT',
  FULL_TEXT: 'FULL_TEXT',
  SYNONYM: 'SYNONYM',
  FUZZY: 'FUZZY',
} as const;

export type MatchReason = (typeof MatchReason)[keyof typeof MatchReason];

export interface SearchResultItem {
  masterProductId: string;
  slug: string;
  name: string;
  brand: string | null;
  categoryId: string;
  netQuantity: number;
  uom: string;
  vegMark: string;
  imageUrl: string | null;

  /** Cheapest purchasable offer, in integer paise. Null when nobody has it. */
  minPricePaise: number | null;
  mrpPaise: number | null;
  /**
   * The offer that price belongs to, so the price is actionable.
   *
   * A storefront cannot add to a basket without it, and recomputing "cheapest"
   * client-side would be a second implementation of the §2.7.3 rule that could
   * disagree with the number already on screen.
   */
  bestOfferId: string | null;
  bestVendorId: string | null;
  /** Drives the §2.7.3 rule that an unavailable offer never outranks an available one. */
  isAvailable: boolean;
  offerCount: number;

  score: number;
  matchReason: MatchReason;
}

export interface SearchResponse {
  query: string;
  /** After synonym and transliteration expansion — shown so ops can see what ran. */
  expandedTerms: string[];
  items: SearchResultItem[];
  total: number;
  /** True when nothing matched, even after correction. Feeds the §2.7.4 health metric. */
  zeroResult: boolean;
  /** Populated on a zero-result search: a corrected query worth retrying. */
  didYouMean?: string;
}

/**
 * Normalises a query before matching.
 *
 * Deliberately conservative — it lowercases, collapses whitespace and strips
 * punctuation, but does not stem. English stemmers mangle transliterated Hindi
 * ("besan" → "besan", but "poha" → "poha" only by luck), so stemming is left to
 * the synonym table where a human decides.
 *
 * **Unicode normalisation to NFC is not optional here.** Devanagari has more
 * than one valid encoding for the same text — आटा can arrive precomposed or as
 * a base character plus combining marks, depending on the keyboard. Without
 * this, two visually identical strings compare unequal and every Hindi search
 * silently misses. It costs nothing on ASCII.
 */
export function normaliseQuery(query: string): string {
  return (
    query
      .normalize('NFC')
      .toLowerCase()
      // \p{M} — combining marks — is essential, not decorative. Devanagari
      // vowel signs like ा are marks, not letters, so omitting it turns आटा
      // into आट and quietly breaks every Devanagari search.
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Collapses unit spellings so "1kg", "1 kg" and "1 kilo" agree.
 *
 * Shoppers type the size as part of the name far more often than they use a
 * filter, so this runs on every query rather than only when a unit is detected.
 */
const UNIT_ALIASES: Record<string, string> = {
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  kgs: 'kg',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  gms: 'g',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  ltr: 'l',
  ml: 'ml',
  millilitre: 'ml',
  piece: 'pc',
  pieces: 'pc',
  pcs: 'pc',
  packet: 'pack',
  packets: 'pack',
};

export function normaliseUnits(query: string): string {
  return (
    query
      .split(' ')
      .map((token) => UNIT_ALIASES[token] ?? token)
      .join(' ')
      // "1 kg" and "1kg" must produce the same tokens.
      .replace(/(\d)\s+(kg|g|l|ml|pc|pack)\b/g, '$1$2')
  );
}

export function prepareQuery(query: string): string {
  return normaliseUnits(normaliseQuery(query));
}

/** Search health metrics (§2.7.4). */
export interface SearchHealthSample {
  query: string;
  resultCount: number;
  zeroResult: boolean;
  durationMs: number;
}
