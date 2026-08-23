/**
 * Stand-in artwork for a product or category.
 *
 * Every one of the 5,433 products in the catalogue has an empty `images` array,
 * and a grocery grid without pictures is unusable — people shop by recognising
 * the packet, not by reading the name.
 *
 * So a product is drawn as the *kind of container* it comes in: atta in a paper
 * sack, oil in a bottle, milk in a carton, dal in a pouch. That is genuinely
 * how a shelf is scanned, and it degrades honestly — nobody mistakes it for a
 * photograph of the actual brand.
 *
 * Real `imageUrl`s take precedence wherever the catalogue has them, so this
 * disappears product by product as photography arrives rather than needing a
 * migration.
 *
 * Keyword matching rather than a table keyed by id: products are created by
 * ops, and a lookup table would need editing every time one is added.
 */

export type DemoArt =
  'packet' | 'bottle' | 'carton' | 'pouch' | 'jar' | 'produce' | 'box' | 'tin';

const ART: ReadonlyArray<readonly [RegExp, DemoArt]> = [
  [/\b(atta|maida|besan|flour|suji|rava|rice|basmati|chawal|sugar|cheeni)\b/i, 'packet'],
  [
    /\b(dal|dahl|arhar|toor|moong|chana|urad|rajma|lentil|pulse|poha|salt|namak)\b/i,
    'pouch',
  ],
  [/\b(oil|tel|sunflower|mustard|groundnut|vinegar|sauce|water|juice|soda)\b/i, 'bottle'],
  [/\b(milk|doodh|toned|taaza|curd|dahi|yogurt|lassi|buttermilk)\b/i, 'carton'],
  [/\b(ghee|butter|makhan|dalda|vanaspati)\b/i, 'tin'],
  [
    /\b(pickle|achar|jam|honey|masala|haldi|turmeric|mirch|jeera|dhania|spice|paste)\b/i,
    'jar',
  ],
  [
    /\b(tomato|onion|potato|aloo|pyaz|vegetable|sabzi|veg|fruit|apple|banana|mango|leafy|greens)\b/i,
    'produce',
  ],
  [
    /\b(biscuit|cookie|snack|namkeen|chips|tea|chai|coffee|cereal|soap|detergent|paste|shampoo)\b/i,
    'box',
  ],
];

/** Which drawing to use. Unmatched gets a packet, the commonest kirana shape. */
export function artFor(name: string): DemoArt {
  return ART.find(([pattern]) => pattern.test(name))?.[1] ?? 'packet';
}

export function artUrl(name: string): string {
  return `/demo/${artFor(name)}.svg`;
}

/**
 * Which of six plate tints sits behind the drawing.
 *
 * Derived from the name so a product keeps the same colour on every screen it
 * appears on — a tile that changes colour between the grid and the basket reads
 * as a different product.
 */
export function tintFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 6;
  }
  return hash + 1;
}

/* -------------------------------------------------------------------------- */

/** Categories keep a glyph: they are 74px tiles, too small for a drawing. */
const GLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/atta|rice|flour|grain|staple/i, '🌾'],
  [/dal|pulse|lentil|bean/i, '🫘'],
  [/oil|ghee|masala|spice/i, '🫗'],
  [/dairy|milk|curd|paneer|butter/i, '🥛'],
  [/veg|fruit|fresh|produce/i, '🥬'],
  [/snack|biscuit|namkeen|sweet/i, '🍪'],
  [/clean|home|detergent|soap/i, '🧼'],
  [/baby|care|personal/i, '🧴'],
  [/beverage|tea|coffee|juice|drink/i, '🍵'],
];

export function glyphFor(name: string): string {
  return GLYPHS.find(([pattern]) => pattern.test(name))?.[1] ?? '🧺';
}
