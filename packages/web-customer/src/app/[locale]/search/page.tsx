import Link from 'next/link';
import { BottomNav, Header } from '@/components/Chrome';
import { ProductGrid } from '@/components/ProductCard';
import { search } from '@/lib/api';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/** Per-request: results depend on live stock, and on the query string. */
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  const t = getDictionary(locale);

  const query = (q ?? '').trim();
  const results = query ? await search(query, locale) : null;

  return (
    <>
      <Header locale={locale} initialQuery={query} />

      <main id="main" className="container">
        {!results ? (
          <p className="empty">{t.searchPlaceholder}</p>
        ) : results.zeroResult ? (
          <section className="section">
            <h1 className="section-title">{t.noResults}</h1>
            <p className="muted">{t.noResultsHint}</p>

            {/*
              A correction is offered only on a zero-result search (§2.7.4) —
              suggesting one for a query that already worked is noise.
            */}
            {results.didYouMean && (
              <p style={{ marginTop: 12 }}>
                {t.didYouMean}{' '}
                <Link
                  href={`/${locale}/search?q=${encodeURIComponent(results.didYouMean)}`}
                  style={{ color: 'var(--brand)', fontWeight: 600 }}
                >
                  {results.didYouMean}
                </Link>
                ?
              </p>
            )}
          </section>
        ) : (
          <section className="section">
            <h1 className="section-title">
              {t.resultsFor} “{query}”
            </h1>
            <ProductGrid
              items={results.items}
              locale={locale}
              emptyMessage={t.noResults}
            />
          </section>
        )}
      </main>

      <BottomNav locale={locale} current="search" />
    </>
  );
}
