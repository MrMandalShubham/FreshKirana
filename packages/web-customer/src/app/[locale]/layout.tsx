import { notFound } from 'next/navigation';
import { LOCALES, isLocale } from '@/i18n/dictionaries';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // `lang` is what tells a screen reader which language to pronounce, and what
  // lets the browser pick a Devanagari font. Not cosmetic (§4.5).
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
