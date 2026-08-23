import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/dictionaries';
import { getThemeChoice } from '@/lib/session';
import { body, display } from '../fonts';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  /*
   * The theme is resolved here rather than in the browser.
   *
   * Stamping `data-theme` during the server render means the very first paint
   * uses the right ground. Deciding it in client JavaScript would show the
   * default first and repaint — the white flash every dark-mode user knows.
   *
   * No attribute at all is the third, most common state: follow the phone.
   */
  const theme = await getThemeChoice();

  return (
    // `lang` is what tells a screen reader how to pronounce the page (§4.5).
    <html
      lang={locale}
      data-theme={theme ?? undefined}
      className={`${body.variable} ${display.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
