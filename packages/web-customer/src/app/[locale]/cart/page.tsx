import Link from 'next/link';
import { BottomNav, Header } from '@/components/Chrome';
import { CartLineRow } from '@/components/CartLine';
import { inr } from '@/lib/money';
import { fetchCart } from '@/lib/orders';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/** The basket is per-shopper and changes constantly. Never cached. */
export const dynamic = 'force-dynamic';

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  const [cart, signedIn] = await Promise.all([fetchCart(), isSignedIn()]);
  const lines = cart?.lines ?? [];
  const totals = cart?.totals;

  if (lines.length === 0) {
    return (
      <>
        <Header locale={locale} />
        <main id="main" className="container">
          <h1 className="section-title">{t.cart}</h1>
          <p className="empty">{t.emptyCart}</p>
          <Link className="button" href={`/${locale}`}>
            {t.startShopping}
          </Link>
        </main>
        <BottomNav locale={locale} current="cart" />
      </>
    );
  }

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <h1 className="section-title">{t.cart}</h1>

        <ul className="cart-lines">
          {lines.map((line) => (
            <CartLineRow key={line.id} line={line} locale={locale} />
          ))}
        </ul>

        {totals && (
          <section className="totals" aria-label={t.orderSummary}>
            <Row label={t.itemsTotal} value={inr(totals.subtotalPaise)} />

            {totals.savingsPaise > 0 && (
              <Row label={t.youSave} value={inr(totals.savingsPaise)} highlight />
            )}

            <Row
              label={t.deliveryFee}
              value={
                totals.deliveryFeePaise === 0 ? t.free : inr(totals.deliveryFeePaise)
              }
            />

            {totals.smallBasketFeePaise > 0 && (
              <Row label={t.smallBasketFee} value={inr(totals.smallBasketFeePaise)} />
            )}

            <Row label={t.packagingFee} value={inr(totals.packagingFeePaise)} />

            <Row label={t.toPay} value={inr(totals.grandTotalPaise)} total />
          </section>
        )}

        {/*
          The §4.2 nudges. Both are worth showing because both are things the
          shopper can act on right now — and the minimum-order one explains a
          fee that otherwise looks arbitrary.
        */}
        {totals && !totals.meetsMinimumOrder && (
          <p className="notice">
            {t.addMoreForMinimum.replace(
              '{amount}',
              inr(totals.amountToMinimumOrderPaise),
            )}
          </p>
        )}

        {totals && totals.amountToFreeDeliveryPaise > 0 && (
          <p className="notice">
            {t.addMoreForFreeDelivery.replace(
              '{amount}',
              inr(totals.amountToFreeDeliveryPaise),
            )}
          </p>
        )}

        <div className="cart-actions">
          {signedIn ? (
            <Link className="button primary" href={`/${locale}/checkout`}>
              {t.checkout}
            </Link>
          ) : (
            // The basket survives sign-in — it is claimed by the account — so
            // this is a step, not a loss.
            <Link className="button primary" href={`/${locale}/signin`}>
              {t.signInToCheckout}
            </Link>
          )}
        </div>
      </main>

      <BottomNav locale={locale} current="cart" />
    </>
  );
}

function Row({
  label,
  value,
  total,
  highlight,
}: {
  label: string;
  value: string;
  total?: boolean;
  highlight?: boolean;
}) {
  return (
    <p className={`totals-row${total ? ' total' : ''}${highlight ? ' highlight' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
