import { UOM_LABEL, type Uom } from '@freshkirana/contracts';
import { AddToCart } from '@/components/AddToCart';
import type { BuyAgainItem } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * "Buy again" (§4.2).
 *
 * Everything bought before, most recent first — a list to browse rather than a
 * prediction. A single purchase belongs here even though it never belongs in
 * the usual basket, which is why the two are separate lists rather than one
 * with a threshold.
 */
export function BuyAgain({ items, locale }: { items: BuyAgainItem[]; locale: Locale }) {
  const t = getDictionary(locale);
  if (items.length === 0) return null;

  return (
    <ul className="buy-again">
      {items.map((item) => (
        <li key={item.masterProductId} className="buy-again-item">
          <span>
            <span className="product-name">{item.name}</span>
            <span className="muted">
              {`${item.netQuantity} ${UOM_LABEL[item.uom as Uom] ?? item.uom.toLowerCase()}`}
              {item.timesOrdered > 1
                ? ` · ${t.boughtTimes.replace('{count}', String(item.timesOrdered))}`
                : ''}
            </span>
          </span>

          <AddToCart
            vendorOfferId={item.vendorOfferId}
            quantity={item.quantity}
            locale={locale}
          />
        </li>
      ))}
    </ul>
  );
}
