import Link from 'next/link';
import { BuyAgain } from '@/components/BuyAgain';
import { BottomNav, Header } from '@/components/Chrome';
import { UsualBasket } from '@/components/UsualBasket';
import { fetchCategories } from '@/lib/api';
import { fetchBuyAgain, fetchUsualBasket } from '@/lib/orders';
import { isSignedIn } from '@/lib/session';
import { type Locale, getDictionary, localisedName } from '@/i18n/dictionaries';

/**
 * Rendered per request, not prerendered at build time.
 *
 * Prices and stock change continuously — §2.7.4 wants stock visible within ten
 * seconds — so a page baked at build time is wrong the moment a vendor edits an
 * offer. It also means the build needs no running API, which is what CI has.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const signedIn = await isSignedIn();

  // Both are per-shopper, so neither exists for a visitor who has not signed
  // in. Asking anyway would be two guaranteed 401s on every home render.
  const [categories, usual, buyAgain] = await Promise.all([
    fetchCategories(),
    signedIn ? fetchUsualBasket() : Promise.resolve([]),
    signedIn ? fetchBuyAgain() : Promise.resolve([]),
  ]);

  return (
    <>
      <a className="skip-link" href="#main">
        {t.home}
      </a>
      <Header locale={locale} />

      <main id="main" className="container">
        {/*
          "Your usual basket" and "Buy again" sit ABOVE categories, per §4.2 and
          §0.3 — they are the differentiator, not a convenience. Both hide
          themselves when empty rather than showing an apology: a new customer
          should see a shop, not two empty promises.
        */}
        {usual.length > 0 && (
          <section className="section" aria-labelledby="usual">
            <h2 className="section-title" id="usual">
              {t.usualBasket}
            </h2>
            <UsualBasket items={usual} locale={locale} />
          </section>
        )}

        {buyAgain.length > 0 && (
          <section className="section" aria-labelledby="again">
            <h2 className="section-title" id="again">
              {t.buyAgain}
            </h2>
            <BuyAgain items={buyAgain} locale={locale} />
          </section>
        )}

        <section className="section" aria-labelledby="cats">
          <h2 className="section-title" id="cats">
            {t.shopByCategory}
          </h2>

          {categories.length === 0 ? (
            <p className="empty">{t.emptyCategory}</p>
          ) : (
            <div className="category-grid">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/${locale}/category/${category.slug}`}
                  className="category-tile"
                >
                  {localisedName(category.name, category.nameI18n, locale)}
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}
