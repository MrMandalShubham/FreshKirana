import Link from 'next/link';
import {
  Money,
  type SearchResultItem,
  UOM_LABEL,
  type Uom,
  VegMark,
  pricePerBaseUnit,
} from '@freshkirana/contracts';
import { type Locale, getDictionary } from '@/i18n/dictionaries';
import { glyphFor, tintFor } from '@/lib/glyph';
import { AddToCart } from './AddToCart';

export function VegBadge({ mark, locale }: { mark: string; locale: Locale }) {
  const t = getDictionary(locale);
  const isNonVeg = mark === VegMark.NON_VEG;

  const label = isNonVeg ? t.nonVeg : mark === VegMark.EGG ? t.egg : t.veg;

  return (
    <span
      className={`veg-mark${isNonVeg ? ' non-veg' : ''}`}
      role="img"
      // Colour alone must never carry meaning (§4.5), so the mark is labelled.
      aria-label={label}
      title={label}
    />
  );
}

/** Formats "500 g" / "5 kg" from the integer quantity the catalog stores. */
export function formatQuantity(netQuantity: number, uom: string): string {
  return `${netQuantity} ${UOM_LABEL[uom as Uom] ?? uom.toLowerCase()}`;
}

/**
 * A product tile (spec §4.2).
 *
 * Rebuilt to be shopped rather than read. People buy groceries by recognising
 * the packet, so the picture leads and everything else is arranged under it in
 * the order a decision actually gets made: what it is, how much of it, what it
 * costs, add it.
 *
 * The card still carries the per-unit price, which is the line easiest to drop
 * and shouldn't be: without it a 900 ml pack at ₹99 reads as cheaper than a
 * litre at ₹105. It sits under the price in small type rather than competing
 * with it.
 */
export function ProductCard({
  item,
  locale,
}: {
  item: SearchResultItem;
  locale: Locale;
}) {
  const t = getDictionary(locale);

  const price = item.minPricePaise;
  const mrp = item.mrpPaise;
  const hasDiscount = price != null && mrp != null && mrp > price;
  const offPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;

  const unitPrice =
    price != null ? pricePerBaseUnit(price, item.netQuantity, item.uom as Uom) : null;

  return (
    <article className={`pcard${item.isAvailable ? '' : ' unavailable'}`}>
      <Link href={`/${locale}/product/${item.slug}`} className="pcard-media">
        {item.imageUrl ? (
          /*
           * A plain <img>, not next/image. The optimiser needs the origin
           * whitelisted in next.config and runs every file through a transform
           * on the server — for catalogue images served from a CDN that is a
           * per-request cost for no gain. `loading="lazy"` covers what matters
           * in a grid this dense.
           */
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={`pcard-plate tint-${tintFor(item.name)}`} aria-hidden="true">
            {glyphFor(item.name)}
          </span>
        )}

        {/* Only worth shouting about above 5% — below that it reads as noise
            and trains people to ignore the badge that matters. */}
        {offPct >= 5 && <span className="pcard-off">{offPct}% OFF</span>}

        {!item.isAvailable && <span className="pcard-out">{t.outOfStock}</span>}
      </Link>

      <div className="pcard-body">
        <div className="pcard-top">
          <VegBadge mark={item.vegMark} locale={locale} />
          <span className="pcard-qty">{formatQuantity(item.netQuantity, item.uom)}</span>
        </div>

        <h3 className="pcard-name">
          <Link href={`/${locale}/product/${item.slug}`}>{item.name}</Link>
        </h3>

        <div className="pcard-foot">
          <span className="pcard-price">
            {price != null ? (
              <>
                <b>{Money.formatINR(price as never)}</b>
                {hasDiscount && <s>{Money.formatINR(mrp as never)}</s>}
                {unitPrice && (
                  <em>
                    {Money.formatINR(unitPrice.pricePaise as never)} {t.perUnit}{' '}
                    {UOM_LABEL[unitPrice.unit]}
                  </em>
                )}
              </>
            ) : (
              <b className="muted">{t.outOfStock}</b>
            )}
          </span>

          {/* The whole point of a grid: add without leaving it. */}
          {item.isAvailable && item.bestOfferId && (
            <AddToCart
              vendorOfferId={item.bestOfferId}
              locale={locale}
              label={t.addToCart}
              compact
            />
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  items,
  locale,
  emptyMessage,
}: {
  items: SearchResultItem[];
  locale: Locale;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <p className="empty">{emptyMessage}</p>;
  }

  return (
    <div className="product-grid">
      {items.map((item) => (
        <ProductCard key={item.masterProductId} item={item} locale={locale} />
      ))}
    </div>
  );
}
