'use client';

import { useState } from 'react';
import { openCheckout } from '@/lib/razorpay';
import { inr } from '@/lib/money';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The pay button behind a recovery link.
 *
 * Opens Razorpay Checkout with the intent the API already created — this side
 * never creates one, because the token is a bearer credential and "anyone with
 * the link can open new payment attempts on this order" is not a property worth
 * having.
 */
export function PayWithLink({
  providerOrderId,
  amountPaise,
  keyId,
  locale,
}: {
  providerOrderId: string;
  amountPaise: number;
  keyId: string | null;
  locale: Locale;
}) {
  const t = getDictionary(locale);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!keyId) {
    return (
      <p className="notice" role="status">
        {t.paymentGatewayMissing}
      </p>
    );
  }

  async function pay() {
    setNotice(null);
    setBusy(true);

    await openCheckout({
      keyId: keyId!,
      providerOrderId,
      amountPaise,
      onClosed: () => {
        setBusy(false);
        setNotice(t.paymentClosed);
      },
      onSubmitted: () => {
        setBusy(false);
        // The webhook is what confirms the order, and it lands a moment later.
        setNotice(t.paymentTakingEffect);
      },
    });
  }

  return (
    <>
      <button className="button" type="button" onClick={pay} disabled={busy}>
        {busy ? t.paymentOpening : t.payNow.replace('{amount}', inr(amountPaise))}
      </button>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
