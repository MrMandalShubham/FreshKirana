import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BottomNav, Header } from '@/components/Chrome';
import { CheckoutForm } from '@/components/CheckoutForm';
import {
  fetchAddresses,
  fetchCart,
  fetchCheckoutPreview,
  fetchSlots,
} from '@/lib/orders';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  // An order needs somebody to deliver to and somebody responsible for the
  // cash, so unlike the basket this is not anonymous.
  if (!(await isSignedIn())) redirect(`/${locale}/signin`);

  const [cart, addresses] = await Promise.all([fetchCart(), fetchAddresses()]);

  if (!cart || cart.lines.length === 0) {
    return (
      <>
        <Header locale={locale} />
        <main id="main" className="container">
          <h1 className="section-title">{t.checkout}</h1>
          <p className="empty">{t.emptyCart}</p>
          <Link className="button" href={`/${locale}`}>
            {t.startShopping}
          </Link>
        </main>
        <BottomNav locale={locale} current="cart" />
      </>
    );
  }

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];

  // Slots belong to the store the basket is pinned to (decision D2) — asking
  // for any other store's would offer a window nobody can deliver in.
  const [slots, preview] = await Promise.all([
    cart.vendorId ? fetchSlots(cart.vendorId) : Promise.resolve([]),
    fetchCheckoutPreview(defaultAddress ? { addressId: defaultAddress.id } : {}),
  ]);

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <h1 className="section-title">{t.checkout}</h1>

        <CheckoutForm
          locale={locale}
          preview={preview}
          addresses={addresses}
          slots={slots}
        />
      </main>

      <BottomNav locale={locale} current="cart" />
    </>
  );
}
