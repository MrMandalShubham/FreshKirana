'use client';

import { useState, useTransition } from 'react';
import { convertOrderToCod, retryPayment } from '@/lib/actions';
import { openCheckout } from '@/lib/razorpay';
import { inr } from '@/lib/money';
import type { RecoveryOffer } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * Getting a failed payment back (§2.10.3).
 *
 * The order is still alive — its stock and its slot are held — so this screen's
 * job is to say that plainly and offer the two ways forward, in the order that
 * asks least of the shopper: pay again, or take the goods and pay cash.
 *
 * Which of the two appear is decided by the API, not here: COD depends on a
 * risk score, and offering a button that 409s is worse than not offering it.
 */
export function PaymentRecovery({
  orderId,
  amountPaise,
  offer,
  locale,
}: {
  orderId: string;
  amountPaise: number;
  offer: RecoveryOffer;
  locale: Locale;
}) {
  const t = getDictionary(locale);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'retry' | 'cod' | null>(null);

  if (!offer.canRetry && !offer.canConvertToCod) return null;

  function pay() {
    setNotice(null);
    setBusy('retry');

    startTransition(async () => {
      const form = new FormData();
      form.set('orderId', orderId);

      const result = await retryPayment(form);

      if (!result.ok || !result.providerOrderId) {
        setBusy(null);
        setNotice(result.error ?? t.paymentClosed);
        return;
      }

      // No key id means this deployment has no gateway configured. Say so
      // rather than opening a checkout that cannot work.
      if (!result.keyId) {
        setBusy(null);
        setNotice(t.paymentGatewayMissing);
        return;
      }

      await openCheckout({
        keyId: result.keyId,
        providerOrderId: result.providerOrderId,
        amountPaise: result.amountPaise ?? amountPaise,
        // Deliberately not "you have paid": the webhook decides that. This only
        // means the customer finished in their UPI app, which is when it is
        // worth re-reading the order.
        onClosed: () => {
          setBusy(null);
          setNotice(t.paymentClosed);
        },
        onSubmitted: () => {
          setBusy(null);
          setNotice(t.paymentTakingEffect);
          setTimeout(() => window.location.reload(), 4_000);
        },
      });
    });
  }

  function takeCash() {
    setNotice(null);
    setBusy('cod');

    startTransition(async () => {
      const form = new FormData();
      form.set('orderId', orderId);

      const result = await convertOrderToCod(form);

      setBusy(null);
      if (!result.ok) setNotice(result.error ?? t.cashNotAvailable);
      // On success the server action revalidates, and this whole block
      // disappears with the PENDING_PAYMENT status that produced it.
    });
  }

  return (
    <section className="section notice warning" aria-live="polite">
      <h2 className="section-title">{t.paymentNotDone}</h2>
      <p>{t.paymentNotDoneHelp}</p>

      <div className="cart-actions">
        {offer.canRetry && (
          <button className="button" type="button" onClick={pay} disabled={pending}>
            {busy === 'retry'
              ? t.payingAgain
              : t.payNow.replace('{amount}', inr(amountPaise))}
          </button>
        )}

        {offer.canConvertToCod && (
          <button
            className="link-button"
            type="button"
            onClick={takeCash}
            disabled={pending}
          >
            {busy === 'cod' ? t.switchingToCash : t.payWithCash}
          </button>
        )}
      </div>

      {!offer.canConvertToCod && offer.codRefusedReason && (
        <p className="muted">{t.cashNotAvailable}</p>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
