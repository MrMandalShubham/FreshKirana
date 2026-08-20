import { inr } from '@/lib/money';
import type { Refund } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * What the customer is owed, and roughly when (§1.8.2).
 *
 * A server component: nothing here is interactive, and a refund is exactly the
 * screen somebody reloads rather than clicks around. Showing it on the order
 * itself, rather than behind a separate "refunds" page, is deliberate — the
 * question is always "what happened to *this* order's money".
 *
 * One row per refund rather than a total, because an order can be refunded more
 * than once — a missing item today, an underweight line tomorrow — and a total
 * cannot answer "what was this ₹80 for?".
 */
export function Refunds({ refunds, locale }: { refunds: Refund[]; locale: Locale }) {
  const t = getDictionary(locale);
  if (refunds.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section-title">{t.refunds}</h2>

      <ul className="order-lines">
        {refunds.map((refund) => (
          <li key={refund.id} className="order-line">
            <span>
              {statusLabel(refund.status, t)}
              <span className="muted"> · {routeLabel(refund.route, t)}</span>
              {/*
               * A range, never a date. The gateway controls the timing and
               * routinely takes the long end, so a precise promise here would
               * turn a slow refund into a broken promise.
               */}
              {refund.status !== 'COMPLETED' && (
                <>
                  <br />
                  <span className="muted">
                    {t.refundExpected
                      .replace('{min}', String(refund.expectedByMinDays))
                      .replace('{max}', String(refund.expectedByMaxDays))}
                  </span>
                </>
              )}
            </span>
            <span>{inr(refund.amountPaise)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusLabel(status: Refund['status'], t: ReturnType<typeof getDictionary>) {
  switch (status) {
    case 'COMPLETED':
      return t.refundCompleted;
    case 'PROCESSING':
      return t.refundProcessing;
    case 'FAILED':
      // Deliberately not "failed": from the customer's side nothing they did
      // failed, and the only useful thing to say is that somebody is on it.
      return t.refundFailed;
    default:
      return t.refundInitiated;
  }
}

function routeLabel(route: Refund['route'], t: ReturnType<typeof getDictionary>) {
  switch (route) {
    case 'BANK_TRANSFER':
      return t.refundToBank;
    case 'STORE_CREDIT':
      return t.refundToStoreCredit;
    default:
      return t.refundToOriginal;
  }
}
