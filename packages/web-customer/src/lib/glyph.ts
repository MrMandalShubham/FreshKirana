/**
 * A stand-in picture for a product or category.
 *
 * Every one of the 5,433 products in the catalogue has an empty `images` array,
 * and a grocery grid without pictures is unusable — people shop by recognising
 * the packet, not by reading the name. Until there is a real image pipeline this
 * draws a tinted plate with a glyph, which reads as *a deliberate placeholder*
 * rather than as a broken image.
 *
 * Keyword matching rather than a lookup table keyed by id: products and
 * categories are created by ops, and a table would need editing every time one
 * is added. Unmatched falls back to a basket, which is honest rather than wrong.
 */

const GLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(atta|maida|besan|flour|suji|rava)\b/i, '🌾'],
  [/\b(rice|basmati|poha|chawal)\b/i, '🍚'],
  [/\b(dal|dahl|arhar|toor|moong|chana|urad|rajma|lentil|pulse)\b/i, '🫘'],
  [/\b(oil|tel|sunflower|mustard|groundnut)\b/i, '🫗'],
  [/\b(ghee|butter|makhan)\b/i, '🧈'],
  [/\b(milk|doodh|dairy|taaza|toned)\b/i, '🥛'],
  [/\b(curd|dahi|yogurt|yoghurt)\b/i, '🥣'],
  [/\b(paneer|cheese)\b/i, '🧀'],
  [/\b(egg|anda)\b/i, '🥚'],
  [/\b(salt|namak|sugar|cheeni|jaggery|gur)\b/i, '🧂'],
  [/\b(masala|spice|haldi|turmeric|mirch|jeera|dhania)\b/i, '🌶️'],
  [/\b(tea|chai|coffee)\b/i, '🍵'],
  [/\b(tomato|onion|potato|aloo|pyaz|vegetable|sabzi|veg)\b/i, '🥬'],
  [/\b(fruit|apple|banana|mango|orange)\b/i, '🍎'],
  [/\b(biscuit|cookie|snack|namkeen|chips)\b/i, '🍪'],
  [/\b(soap|detergent|surf|clean|wash|phenyl)\b/i, '🧼'],
  [/\b(shampoo|paste|brush|care|lotion)\b/i, '🧴'],
  [/\b(water|juice|drink|soda|beverage)\b/i, '🧃'],
  [/\b(bread|bun|pav|rusk)\b/i, '🍞'],
  [/\b(staple|grocery|kirana|provision)\b/i, '🛍️'],
];

export function glyphFor(name: string): string {
  return GLYPHS.find(([pattern]) => pattern.test(name))?.[1] ?? '🧺';
}

/**
 * Which of six plate tints to use.
 *
 * Derived from the name so a product keeps the same colour on every screen it
 * appears on — a card that changes colour between the grid and the basket reads
 * as a different product.
 */
export function tintFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 6;
  }
  return hash + 1;
}
