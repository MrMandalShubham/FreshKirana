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
 * Carries image, name, net quantity, price, MRP, savings, **per-unit price**
 * and the veg mark. The per-unit line is the one that is easy to drop and
 * shouldn't be: without it a 900 ml pack at ₹99 reads as cheaper than a litre
 * at ₹105.
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

  const unitPrice =
    price != null ? pricePerBaseUnit(price, item.netQuantity, item.uom as Uom) : null;

  return (
    <article className={`product-card${item.isAvailable ? '' : ' unavailable'}`}>
      <Link href={`/${locale}/product/${item.slug}`}>
        <div className="price-row" style={{ marginBottom: 4 }}>
          <VegBadge mark={item.vegMark} locale={locale} />
          {!item.isAvailable && <span className="badge out">{t.outOfStock}</span>}
        </div>

        <h3 className="product-name">{item.name}</h3>
        <div className="product-qty">{formatQuantity(item.netQuantity, item.uom)}</div>

        {price != null ? (
          <>
            <div className="price-row">
              <span className="price">{Money.formatINR(price as never)}</span>
              {hasDiscount && (
                <span className="price-mrp">{Money.formatINR(mrp as never)}</span>
              )}
            </div>
            {unitPrice && (
              <div className="price-unit">
                {Money.formatINR(unitPrice.pricePaise as never)} {t.perUnit}{' '}
                {UOM_LABEL[unitPrice.unit]}
              </div>
            )}
          </>
        ) : (
          <div className="muted">{t.outOfStock}</div>
        )}

        {item.offerCount > 0 && (
          <div className="price-unit">
            {item.offerCount} {item.offerCount === 1 ? t.seller : t.sellers}
          </div>
        )}
      </Link>
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
