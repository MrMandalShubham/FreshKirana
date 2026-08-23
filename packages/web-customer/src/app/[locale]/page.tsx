import Link from 'next/link';
import { BuyAgain } from '@/components/BuyAgain';
import { BottomNav, Header } from '@/components/Chrome';
import { HomeHero } from '@/components/HomeHero';
import { ProductCard } from '@/components/ProductCard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UsualBasket } from '@/components/UsualBasket';
import { fetchCategories, fetchHomeShelf } from '@/lib/api';
import { fetchBuyAgain, fetchUsualBasket } from '@/lib/orders';
import { getThemeChoice, isSignedIn } from '@/lib/session';
import { glyphFor } from '@/lib/glyph';
import { type Locale, getDictionary, localisedName } from '@/i18n/dictionaries';

/**
 * Rendered per request, not prerendered at build time.
 *
 * Prices and stock change continuously — §2.7.4 wants stock visible within ten
 * seconds — so a page baked at build time is wrong the moment a vendor edits an
 * offer. It also means the build needs no running API, which is what CI has.
 */
export const dynamic = 'force-dynamic';

/**
 * How many categories the rail carries.
 *
 * Staging returns 696 — mostly e2e debris, but a real city catalogue will run
 * to dozens, and nobody browses a list that long. The rail shows a screenful
 * and search covers the rest, which is how people find "toor dal" anyway.
 */
const CATEGORY_RAIL_LIMIT = 12;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const signedIn = await isSignedIn();
  const theme = await getThemeChoice();

  // Both are per-shopper, so neither exists for a visitor who has not signed
  // in. Asking anyway would be two guaranteed 401s on every home render.
  const [categories, usual, buyAgain] = await Promise.all([
    fetchCategories(),
    signedIn ? fetchUsualBasket() : Promise.resolve([]),
    signedIn ? fetchBuyAgain() : Promise.resolve([]),
  ]);

  const rail = categories.slice(0, CATEGORY_RAIL_LIMIT);
  // Depends on the categories, so it cannot join the batch above.
  const shelf = await fetchHomeShelf(rail.map((category) => category.id));

  return (
    <>
      <a className="skip-link" href="#main">
        {t.home}
      </a>
      <Header locale={locale} />

      <main id="main" className="container">
        <HomeHero locale={locale} />

        {/* Real promises, not coupon codes. There is no promotions engine, and
            a chip reading "GREEN75" that does nothing is a lie on the home
            page. These three are things the app actually does. */}
        <ul className="promise-strip">
          <li>{t.slotYouChoose}</li>
          <li>{t.freeDeliveryAbove}</li>
          <li>{t.weighedAtCounter}</li>
        </ul>

        <section className="section" aria-labelledby="cats">
          <h2 className="section-title" id="cats">
            {t.shopByCategory}
          </h2>

          {categories.length === 0 ? (
            <p className="empty">{t.emptyCategory}</p>
          ) : (
            <div className="category-rail">
              {rail.map((category) => {
                const name = localisedName(category.name, category.nameI18n, locale);
                return (
                  <Link
                    key={category.id}
                    href={`/${locale}/category/${category.slug}`}
                    className="category-tile"
                  >
                    {/* Decorative: the category's own name is the label, and a
                        screen reader reading "wheat, Atta and Rice" is worse. */}
                    <span className="disc" aria-hidden="true">
                      {glyphFor(name)}
                    </span>
                    {name}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/*
          "Your usual basket" is the §0.3 wedge, so it outranks every shelf
          below it. Both it and "Buy again" hide when empty rather than showing
          an apology: a new shopper should see a shop, not two empty promises.
        */}
        {usual.length > 0 && (
          <section aria-labelledby="usual">
            <div className="hero-card">
              <h2 id="usual">{t.usualBasket}</h2>
              <p className="hero-sub">
                {t.usualBasketSub.replace('{count}', String(usual.length))}
              </p>
              <UsualBasket items={usual} locale={locale} />
            </div>
          </section>
        )}

        {buyAgain.length > 0 && (
          <section className="section" aria-labelledby="again">
            <div className="shelf-head">
              <h2 className="section-title" id="again">
                {t.buyAgain}
              </h2>
            </div>
            <BuyAgain items={buyAgain} locale={locale} />
          </section>
        )}

        {shelf.length > 0 && (
          <section className="section" aria-labelledby="popular">
            <div className="shelf-head">
              <h2 className="section-title" id="popular">
                {t.bestSellers}
              </h2>
              <Link className="shelf-more" href={`/${locale}/search`}>
                {t.seeAll}
              </Link>
            </div>

            <div className="product-grid">
              {shelf.map((item) => (
                <ProductCard key={item.masterProductId} item={item} locale={locale} />
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <h2 className="section-title">{t.appearance}</h2>
          <ThemeToggle current={theme} locale={locale} />
        </section>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}
