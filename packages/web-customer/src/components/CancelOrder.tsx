'use client';

import { useActionState, useState } from 'react';
import { cancelOrder, type ActionResult } from '@/lib/actions';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * Cancelling, within the §1.8.1 window.
 *
 * Behind a confirmation step, because this is irreversible and sits on a screen
 * people open to *check* on an order. One stray tap should not end it.
 */
export function CancelOrder({ orderId, locale }: { orderId: string; locale: Locale }) {
  const t = getDictionary(locale);
  const [confirming, setConfirming] = useState(false);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => cancelOrder(formData),
    null,
  );

  if (!confirming) {
    return (
      <button
        className="link-button danger"
        type="button"
        onClick={() => setConfirming(true)}
      >
        {t.cancelOrder}
      </button>
    );
  }

  return (
    <form action={formAction} className="cancel-order">
      <input type="hidden" name="orderId" value={orderId} />

      <label className="field">
        <span>{t.cancelReason}</span>
        <input className="input" name="reason" maxLength={200} />
      </label>

      <div className="cart-actions">
        <button className="button danger" type="submit" disabled={pending}>
          {pending ? t.cancelling : t.confirmCancel}
        </button>
        <button
          className="link-button"
          type="button"
          onClick={() => setConfirming(false)}
        >
          {t.keepOrder}
        </button>
      </div>

      {state?.ok === false && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
