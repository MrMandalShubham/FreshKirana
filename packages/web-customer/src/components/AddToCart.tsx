'use client';

import { useActionState } from 'react';
import { addToCart, type ActionResult } from '@/lib/actions';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The add button (spec §4.2).
 *
 * A real `<form>` posting to a server action, so it works before the JavaScript
 * has loaded — on the mid-range Android of §4.1 that window is real. The client
 * component exists only to show what came back, because one failure here has to
 * be explained rather than swallowed: a basket already belonging to another
 * shop (decision D2), which looks like the button simply not working.
 */
export function AddToCart({
  vendorOfferId,
  quantity,
  locale,
  label,
}: {
  vendorOfferId: string;
  quantity?: number;
  locale: Locale;
  label?: string;
}) {
  const t = getDictionary(locale);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => addToCart(formData),
    null,
  );

  return (
    <form action={formAction} className="add-to-cart">
      <input type="hidden" name="vendorOfferId" value={vendorOfferId} />
      {quantity !== undefined && <input type="hidden" name="quantity" value={quantity} />}

      <button className="button" type="submit" disabled={pending}>
        {pending ? t.adding : (label ?? t.addToCart)}
      </button>

      {state?.ok === false && (
        <p className="notice error" role="alert">
          {state.code === 'CART_VENDOR_CONFLICT' ? t.differentStore : state.error}
        </p>
      )}

      {state?.ok === true && (
        <p className="notice success" role="status">
          {t.addedToCart}
        </p>
      )}
    </form>
  );
}
