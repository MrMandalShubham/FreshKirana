import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BottomNav, Header } from '@/components/Chrome';
import { CancelOrder } from '@/components/CancelOrder';
import { OrderTimeline } from '@/components/OrderTimeline';
import { CodConfirm } from '@/components/CodConfirm';
import { PaymentRecovery } from '@/components/PaymentRecovery';
import { inr } from '@/lib/money';
import { fetchCodConfirmation, fetchOrder, fetchRecoveryOffer } from '@/lib/orders';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * Per-request, and deliberately not cached for a second.
 *
 * This is the screen a customer refreshes while they wait. A cached page that
 * shows "Confirming with store" after the store has accepted is worse than a
 * slow one.
 */
export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: Locale; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const t = getDictionary(locale);

  if (!(await isSignedIn())) redirect(`/${locale}/signin`);

  const order = await fetchOrder(orderId);
  if (!order) notFound();

  const canCancel = order.nextActions.some((action) => action.to === 'CANCELLED');

  /*
   * PENDING_PAYMENT means two different things, and the screen must not guess.
   *
   * A prepaid order is there because a payment failed (§2.10.3). A cash order
   * is there because §2.10.4 wants the customer to vouch for it before any shop
   * starts packing — there is no payment behind it to retry, and offering "pay
   * cash on delivery instead" on an order that already is cash would be
   * nonsense. It was worse than nonsense: that button used to release the order
   * to the store, walking around the confirmation entirely.
   *
   * Asked for only when it could matter. A packed or delivered order has
   * nothing pending, and a request per order view would cost every shopper a
   * round trip for a block almost none of them will see.
   */
  const waiting = order.status === 'PENDING_PAYMENT';
  const isCash = order.paymentMethod === 'COD';

  const recovery = waiting && !isCash ? await fetchRecoveryOffer(order.id) : null;
  const codConfirmation = waiting && isCash ? await fetchCodConfirmation(order.id) : null;

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <p className="muted">{order.orderNumber}</p>
        <h1 className="section-title">{order.label ?? order.status}</h1>

        {codConfirmation?.pending && (
          <CodConfirm
            orderId={order.id}
            confirmation={codConfirmation}
            phone={order.recipientPhone}
            locale={locale}
          />
        )}

        {recovery && (
          <PaymentRecovery
            orderId={order.id}
            amountPaise={order.grandTotalPaise}
            offer={recovery}
            locale={locale}
          />
        )}

        <OrderTimeline timeline={order.timeline} locale={locale} />

        <section className="section">
          <h2 className="section-title">{t.deliverySlot}</h2>
          <p>{formatSlot(order.slotStartsAt, order.slotEndsAt, locale)}</p>
          <p className="muted">
            {order.recipientName} · {order.addressLine1}, {order.addressCity}{' '}
            {order.addressPincode}
          </p>
        </section>

        <section className="section">
          <h2 className="section-title">{t.items}</h2>
          <ul className="order-lines">
            {order.lines.map((line) => (
              <li key={line.id} className="order-line">
                <span>
                  {line.name}
                  <span className="muted"> × {line.quantity}</span>
                </span>
                <span>{inr(line.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="totals">
          <p className="totals-row">
            <span>{t.itemsTotal}</span>
            <span>{inr(order.itemsSubtotalPaise)}</span>
          </p>
          <p className="totals-row">
            <span>{t.deliveryFee}</span>
            <span>
              {order.deliveryFeePaise === 0 ? t.free : inr(order.deliveryFeePaise)}
            </span>
          </p>
          {order.smallBasketFeePaise > 0 && (
            <p className="totals-row">
              <span>{t.smallBasketFee}</span>
              <span>{inr(order.smallBasketFeePaise)}</span>
            </p>
          )}
          <p className="totals-row">
            <span>{t.packagingFee}</span>
            <span>{inr(order.packagingFeePaise)}</span>
          </p>
          <p className="totals-row total">
            <span>{order.codCollectablePaise > 0 ? t.payOnDelivery : t.totalPaid}</span>
            <span>{inr(order.grandTotalPaise)}</span>
          </p>
        </section>

        {canCancel && <CancelOrder orderId={order.id} locale={locale} />}

        <Link className="link-button" href={`/${locale}/orders`}>
          {t.allOrders}
        </Link>
      </main>

      <BottomNav locale={locale} current="orders" />
    </>
  );
}

function formatSlot(startsAt: string, endsAt: string, locale: Locale): string {
  const tag = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const day = new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(startsAt));

  const time = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));

  return `${day}, ${time(startsAt)} – ${time(endsAt)}`;
}
