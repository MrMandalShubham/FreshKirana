import Link from 'next/link';
import { type Locale, getDictionary, LOCALE_LABEL, LOCALES } from '@/i18n/dictionaries';

/** Header with the search bar, per §4.2: pinned to the top of every screen. */
export function Header({
  locale,
  initialQuery,
}: {
  locale: Locale;
  initialQuery?: string;
}) {
  const t = getDictionary(locale);

  return (
    <header className="header">
      <div className="container header-row">
        <Link href={`/${locale}`} className="brand">
          {t.appName}
        </Link>

        {/*
          A plain GET form, deliberately. Search works before any JavaScript
          loads, which on the mid-range Android of §4.1 is a real window.
        */}
        <form
          className="search-form"
          action={`/${locale}/search`}
          method="get"
          role="search"
        >
          <label className="skip-link" htmlFor="q">
            {t.search}
          </label>
          <input
            id="q"
            name="q"
            className="search-input"
            type="search"
            placeholder={t.searchPlaceholder}
            defaultValue={initialQuery ?? ''}
            autoComplete="off"
          />
          <button className="button" type="submit">
            {t.search}
          </button>
        </form>
      </div>
    </header>
  );
}

/** Bottom navigation (§4.1): primary actions within thumb reach. */
export function BottomNav({ locale, current }: { locale: Locale; current: string }) {
  const t = getDictionary(locale);

  const items = [
    { href: `/${locale}`, key: 'home', label: t.home, icon: '⌂' },
    { href: `/${locale}/search`, key: 'search', label: t.search, icon: '⌕' },
    { href: `/${locale}/cart`, key: 'cart', label: t.cart, icon: '≡' },
    { href: `/${locale}/orders`, key: 'orders', label: t.orders, icon: '◴' },
    { href: `/${locale}/account`, key: 'account', label: t.account, icon: '○' },
  ];

  return (
    <nav className="bottom-nav" aria-label={t.home}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Language switch.
 *
 * Links rather than a client-side toggle: the locale lives in the URL, so a
 * chosen language survives sharing, bookmarking and a cold start.
 */
export function LocaleSwitch({ locale, path }: { locale: Locale; path: string }) {
  return (
    <div className="locale-switch">
      {LOCALES.map((candidate) => (
        <Link
          key={candidate}
          href={`/${candidate}${path}`}
          aria-current={candidate === locale ? 'true' : undefined}
          hrefLang={candidate}
        >
          {LOCALE_LABEL[candidate]}
        </Link>
      ))}
    </div>
  );
}
