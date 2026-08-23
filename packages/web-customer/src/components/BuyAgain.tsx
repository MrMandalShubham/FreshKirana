import Link from 'next/link';
import { UOM_LABEL, type Uom } from '@freshkirana/contracts';
import { AddToCart } from './AddToCart';
import type { BuyAgainItem } from '@/lib/orders';
import { artUrl, tintFor } from '@/lib/glyph';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * "Buy again" — everything bought before, most recent first (§4.2).
 *
 * Was a bare list of names with an add button, which told a shopper nothing
 * they could act on: no picture, no price, and no way through to the product.
 * It is now the same tile as every other shelf, so the name opens the product
 * page and the button adds without leaving home.
 *
 * Deliberately a rail rather than a grid. This is a list to browse, not a
 * prediction — the usual basket above it is the prediction — so it should take
 * one row and get out of the way.
 */
export function BuyAgain({ items, locale }: { items: BuyAgainItem[]; locale: Locale }) {
  const t = getDictionary(locale);

  return (
    <div className="shelf">
      {items.map((item) => (
        <article key={item.masterProductId} className="pcard">
          <Link href={`/${locale}/product/${item.slug}`} className="pcard-media">
            <span className={`pcard-plate tint-${tintFor(item.name)}`}>
              <img src={artUrl(item.name)} alt="" loading="lazy" decoding="async" />
            </span>
          </Link>

          <div className="pcard-body">
            <div className="pcard-top">
              <span className="pcard-qty">
                {`${item.netQuantity} ${UOM_LABEL[item.uom as Uom] ?? item.uom.toLowerCase()}`}
              </span>
            </div>

            <h3 className="pcard-name">
              <Link href={`/${locale}/product/${item.slug}`}>{item.name}</Link>
            </h3>

            <div className="pcard-foot">
              <span className="pcard-price">
                {/*
                  Why it is here, which is the whole reason this shelf beats a
                  generic "recommended" row: it is something they actually buy.
                */}
                <em>
                  {item.timesOrdered > 1
                    ? t.boughtTimes.replace('{count}', String(item.timesOrdered))
                    : t.buyAgain}
                </em>
              </span>

              <AddToCart
                vendorOfferId={item.vendorOfferId}
                quantity={item.quantity}
                locale={locale}
                label={t.addToCart}
                compact
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
