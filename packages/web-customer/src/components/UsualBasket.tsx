'use client';

import { useActionState } from 'react';
import { UOM_LABEL, type Uom } from '@freshkirana/contracts';
import { addUsualBasket, type ActionResult } from '@/lib/actions';
import type { UsualBasketItem } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * "Your usual basket" — the §0.3 wedge, one tap (§4.2).
 *
 * The whole point is that it is *one* tap. A list requiring the shopper to add
 * items one at a time is a list of suggestions, which every marketplace has;
 * the reason to build this is that a week's shopping takes a second.
 *
 * Each item says why it is here — "about every 7 days, last bought 8 days ago".
 * Without that the list is something to audit item by item, which costs more
 * attention than shopping would have.
 */
export function UsualBasket({
  items,
  locale,
}: {
  items: UsualBasketItem[];
  locale: Locale;
}) {
  const t = getDictionary(locale);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => addUsualBasket(),
    null,
  );

  if (items.length === 0) return null;

  return (
    <div className="usual-basket">
      <ul className="usual-list">
        {items.map((item) => (
          <li key={item.masterProductId} className="usual-item">
            <span className="usual-item-main">
              <span className="product-name">{item.name}</span>
              <span className="muted">
                {item.quantity} ×{' '}
                {`${item.netQuantity} ${UOM_LABEL[item.uom as Uom] ?? item.uom.toLowerCase()}`}
              </span>
            </span>

            <span className="muted usual-why">{because(item, t)}</span>
          </li>
        ))}
      </ul>

      <form action={formAction}>
        <button className="button primary wide" type="submit" disabled={pending}>
          {pending ? t.adding : t.addAllToCart.replace('{count}', String(items.length))}
        </button>
      </form>

      {state?.ok === false && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}

      {state?.ok === true && state.skipped ? (
        // Named rather than silently dropped: a shopper who is told two items
        // were unavailable can go and look for them.
        <p className="notice" role="status">
          {t.someItemsSkipped.replace('{count}', String(state.skipped))}
        </p>
      ) : null}
    </div>
  );
}

/** Why this item is in the list, in a sentence a person accepts or rejects. */
function because(item: UsualBasketItem, t: ReturnType<typeof getDictionary>): string {
  const days = Math.round(item.daysSinceLastPurchase);

  if (item.medianIntervalDays === null) {
    return t.boughtBefore.replace('{days}', String(days));
  }

  return t.usuallyEvery
    .replace('{interval}', String(Math.round(item.medianIntervalDays)))
    .replace('{days}', String(days));
}
