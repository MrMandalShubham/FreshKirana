import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PickingList } from '@/components/PickingList';
import { fetchVendorOrders } from '@/lib/orders';
import { inr } from '@/lib/money';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The picking list (P4.1, §1.7.2).
 *
 * One order, its lines, and the two things a picker does: move the order along,
 * and say when a shelf was empty. Everything that happens after "out of stock"
 * is the customer's preference, decided by the API — a picker who could choose
 * would be deciding for somebody who already said what they wanted.
 *
 * Minimal on purpose; P7.1 builds the real dashboard.
 */
export const dynamic = 'force-dynamic';

export default async function PickingPage({
  params,
}: {
  params: Promise<{ locale: Locale; branchId: string; orderId: string }>;
}) {
  const { locale, branchId, orderId } = await params;
  const t = getDictionary(locale);

  if (!(await isSignedIn())) redirect(`/${locale}/signin?vendor=${branchId}`);

  // Read from the store's own list, so this page cannot show an order that
  // belongs to another shop even if somebody guesses the id (§3.2).
  const orders = await fetchVendorOrders(branchId);
  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) notFound();

  return (
    <main id="main" className="container">
      <p className="muted">{order.orderNumber}</p>
      <h1 className="section-title">{order.label ?? order.status}</h1>

      <p className="muted">
        {order.recipientName} · {order.addressLine1}, {order.addressPincode}
      </p>

      <PickingList
        branchId={branchId}
        orderId={order.id}
        status={order.status}
        lines={order.lines}
        nextActions={order.nextActions}
        locale={locale}
      />

      <section className="totals">
        <p className="totals-row total">
          <span>
            {order.codCollectablePaise > 0 ? t.vendorCollectCash : t.vendorPrepaid}
          </span>
          <span>{inr(order.grandTotalPaise)}</span>
        </p>
      </section>

      <Link className="link-button" href={`/${locale}/vendor/${branchId}`}>
        {t.vendorBackToQueue}
      </Link>
    </main>
  );
}
