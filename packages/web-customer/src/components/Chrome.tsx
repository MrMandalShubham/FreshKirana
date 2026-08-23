import Link from 'next/link';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

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
    { href: `/${locale}`, key: 'home', label: t.home, icon: <HomeIcon /> },
    { href: `/${locale}/search`, key: 'search', label: t.search, icon: <SearchIcon /> },
    { href: `/${locale}/cart`, key: 'cart', label: t.cart, icon: <BagIcon /> },
    { href: `/${locale}/orders`, key: 'orders', label: t.orders, icon: <ClockIcon /> },
    { href: `/${locale}/account`, key: 'account', label: t.account, icon: <UserIcon /> },
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

/*
 * Navigation icons.
 *
 * Inline SVG rather than an icon font or a package: five icons is about 1 KB of
 * markup, where any library is a dependency and a font is a separate request
 * that renders as tofu until it lands. The previous version used text glyphs
 * (⌂ ⌕ ≡ ◴ ○), which are a different weight and baseline in every font and
 * read as unfinished.
 *
 * `stroke="currentColor"` so the active tab colours itself from the tab's own
 * rule rather than needing a second icon.
 */
const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.4 12 3.6l9 6.8V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 7h14l1 13H4z" />
      <path d="M9 10V6a3 3 0 0 1 6 0v4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2v5l3.2 2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8.4" r="3.7" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}
