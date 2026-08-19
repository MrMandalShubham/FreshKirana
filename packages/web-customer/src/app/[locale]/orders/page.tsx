import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BottomNav, Header } from '@/components/Chrome';
import { inr } from '@/lib/money';
import { fetchOrders } from '@/lib/orders';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  if (!(await isSignedIn())) redirect(`/${locale}/signin`);

  const orders = await fetchOrders();

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <h1 className="section-title">{t.orders}</h1>

        {orders.length === 0 ? (
          <>
            <p className="empty">{t.noOrders}</p>
            <Link className="button" href={`/${locale}`}>
              {t.startShopping}
            </Link>
          </>
        ) : (
          <ul className="order-list">
            {orders.map((order) => (
              <li key={order.id}>
                <Link className="order-card" href={`/${locale}/orders/${order.id}`}>
                  <span className="order-card-top">
                    <strong>{order.label ?? order.status}</strong>
                    <span>{inr(order.grandTotalPaise)}</span>
                  </span>
                  <span className="muted">
                    {order.orderNumber} · {order.lines.length}{' '}
                    {order.lines.length === 1 ? t.item : t.items} ·{' '}
                    {formatDate(order.placedAt, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <BottomNav locale={locale} current="orders" />
    </>
  );
}

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
