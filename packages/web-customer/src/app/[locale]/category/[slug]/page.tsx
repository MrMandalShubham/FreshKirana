import { notFound } from 'next/navigation';
import { BottomNav, Header } from '@/components/Chrome';
import { ProductGrid } from '@/components/ProductCard';
import { browseCategory, fetchCategories } from '@/lib/api';
import { type Locale, getDictionary, localisedName } from '@/i18n/dictionaries';

/** Per-request: a listing ordered by availability is only right if it is live. */
export const dynamic = 'force-dynamic';

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = getDictionary(locale);

  const categories = await fetchCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const results = await browseCategory(category.id);

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <section className="section">
          <h1 className="section-title">
            {localisedName(category.name, category.nameI18n, locale)}
          </h1>
          <ProductGrid
            items={results.items}
            locale={locale}
            emptyMessage={t.emptyCategory}
          />
        </section>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}
