import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchVendorOrders } from '@/lib/orders';
import { inr } from '@/lib/money';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The store's queue (P4.1, §1.9.3).
 *
 * ## Why this exists before P7.1
 *
 * The kirana's real interface is WhatsApp (§0.3), and the full dashboard is
 * P7.1 — a shop owner will not learn a new app, and building one first is how
 * you end up with no vendors. That has not changed.
 *
 * What changed is that P4.1 and P4.2 are the first parts whose flow *starts*
 * with the picker: somebody finds an empty shelf, somebody puts tomatoes on a
 * scale. Their confirmation tests are unrunnable without a screen, and a part
 * that cannot be confirmed is a part reported as done on the strength of its
 * own tests.
 *
 * So: deliberately the smallest thing that makes those two flows tappable. Not
 * a dashboard. P7.1 replaces it with the real one — today view, SLA urgency,
 * barcode add, money statement — and this page is expected to be deleted then.
 */
export const dynamic = 'force-dynamic';

/** Orders the shop still has to do something about, most urgent first. */
const NEEDS_ACTION = [
  'AWAITING_VENDOR',
  'ACCEPTED',
  'PICKING',
  'SUBSTITUTION_PENDING',
  'PACKED',
];

export default async function VendorQueuePage({
  params,
}: {
  params: Promise<{ locale: Locale; branchId: string }>;
}) {
  const { locale, branchId } = await params;
  const t = getDictionary(locale);

  if (!(await isSignedIn())) redirect(`/${locale}/signin?vendor=${branchId}`);

  const orders = await fetchVendorOrders(branchId);

  // Oldest first: the one closest to breaching its §1.9.4 acceptance SLA is the
  // one somebody should pick up next.
  const queue = orders
    .filter((order) => NEEDS_ACTION.includes(order.status))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));

  return (
    <main id="main" className="container">
      <p className="muted">{t.vendorQueueNotice}</p>
      <h1 className="section-title">{t.vendorQueue}</h1>

      {queue.length === 0 ? (
        <p className="notice">{t.vendorNoOrders}</p>
      ) : (
        <ul className="order-lines">
          {queue.map((order) => (
            <li key={order.id} className="order-line">
              <Link href={`/${locale}/vendor/${branchId}/orders/${order.id}`}>
                <strong>{order.orderNumber}</strong>
                <span className="muted">
                  {' '}
                  · {order.label ?? order.status} · {order.lines.length} {t.item}
                </span>
              </Link>
              <span>{inr(order.grandTotalPaise)}</span>
            </li>
          ))}
        </ul>
      )}

      <Link className="link-button" href={`/${locale}`}>
        {t.backToHome}
      </Link>
    </main>
  );
}
