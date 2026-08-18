import Link from 'next/link';
import { BottomNav, Header, LocaleSwitch } from '@/components/Chrome';
import { fetchCategories } from '@/lib/api';
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
  const categories = await fetchCategories();

  return (
    <>
      <a className="skip-link" href="#main">
        {t.home}
      </a>
      <Header locale={locale} />

      <main id="main" className="container">
        {/*
          "Your usual basket" and "Buy again" sit ABOVE categories, per §4.2 and
          §0.3 — they are the differentiator, not a convenience. They stay as
          placeholders until order history exists (P2.7), but the position is
          reserved now so the page is never redesigned around them later.
        */}
        <section className="section" aria-labelledby="usual">
          <h2 className="section-title" id="usual">
            {t.usualBasket}
          </h2>
          <p className="empty">{t.comingSoon}</p>
        </section>

        <section className="section" aria-labelledby="again">
          <h2 className="section-title" id="again">
            {t.buyAgain}
          </h2>
          <p className="empty">{t.comingSoon}</p>
        </section>

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

        <section className="section">
          <h2 className="section-title">{t.language}</h2>
          <LocaleSwitch locale={locale} path="" />
        </section>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}
