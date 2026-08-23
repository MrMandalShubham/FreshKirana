import Link from 'next/link';
import { BuyAgain } from '@/components/BuyAgain';
import { BottomNav, Header } from '@/components/Chrome';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UsualBasket } from '@/components/UsualBasket';
import { fetchCategories } from '@/lib/api';
import { fetchBuyAgain, fetchUsualBasket } from '@/lib/orders';
import { getThemeChoice, isSignedIn } from '@/lib/session';
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
  const theme = await getThemeChoice();

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
              {categories.map((category) => {
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
        <section className="section">
          <h2 className="section-title">{t.appearance}</h2>
          <ThemeToggle current={theme} locale={locale} />
        </section>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}

/**
 * A glyph for a category tile.
 *
 * Keyword matching rather than a category-id map, because categories are
 * created by ops and a map would need editing every time one is added. An
 * unmatched category gets the basket, which is honest rather than wrong.
 *
 * Placeholder for real category artwork — the one part of the design that
 * needs a photographer rather than code.
 */
const GLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/atta|rice|flour|grain|staple/i, '🌾'],
  [/dal|pulse|lentil|bean/i, '🫘'],
  [/oil|ghee|masala|spice/i, '🫗'],
  [/dairy|milk|curd|paneer|butter/i, '🥛'],
  [/veg|fruit|fresh|produce/i, '🥬'],
  [/snack|biscuit|namkeen|sweet/i, '🍪'],
  [/clean|home|detergent|soap/i, '🧼'],
  [/baby|care|personal/i, '🧴'],
  [/beverage|tea|coffee|juice|drink/i, '🍵'],
];

function glyphFor(name: string): string {
  return GLYPHS.find(([pattern]) => pattern.test(name))?.[1] ?? '🧺';
}
