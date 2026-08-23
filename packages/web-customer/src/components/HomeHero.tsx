import Link from 'next/link';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The promotional banner at the top of the shop.
 *
 * What it says is deliberately what FreshKirana actually does. The obvious
 * thing to write here is "delivered in minutes", which is what every quick
 * commerce app promises — and it is the one claim this product does not make
 * (§0.2). We compete on range, price and basket completion, in a slot the
 * shopper picked. Writing someone else's promise here would set an expectation
 * the rest of the app then breaks.
 *
 * No coupon codes either. There is no promotions engine, and a chip reading
 * "GREEN75" that does nothing when typed is a lie printed on the home page.
 */
export function HomeHero({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);

  return (
    <section className="hero-banner" aria-labelledby="hero-h">
      <div className="hero-banner-copy">
        <span className="hero-badge">{t.heroBadge}</span>

        <h1 id="hero-h">{t.heroTitle}</h1>
        <p>{t.heroSub}</p>

        <Link className="hero-cta" href={`/${locale}/search`}>
          {t.heroCta}
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />
          </svg>
        </Link>
      </div>

      {/* Decorative. A basket of produce, drawn rather than photographed —
          same reason as the product tiles, and it costs about 600 bytes. */}
      <div className="hero-banner-art" aria-hidden="true">
        <svg viewBox="0 0 200 150" role="presentation">
          <ellipse cx="100" cy="132" rx="62" ry="9" fill="#0f2117" opacity=".08" />
          <circle cx="74" cy="58" r="15" fill="#e2705f" />
          <path
            d="M74 43c-1-6 2-9 6-10"
            stroke="#5aa464"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="103" cy="50" r="13" fill="#f2a61c" />
          <path d="M126 74c6-14 3-26-4-31 9 1 17 11 15 24" fill="#f6cf5c" />
          <path
            d="M56 74h88l-9 52a8 8 0 0 1-8 7H73a8 8 0 0 1-8-7z"
            fill="#fbf7ec"
            stroke="#0f2117"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M56 74h88" stroke="#0f2117" strokeWidth="3" strokeLinecap="round" />
          <rect x="112" y="86" width="20" height="34" rx="4" fill="#3d7fd6" />
          <rect x="116" y="80" width="12" height="8" rx="2" fill="#2b60a8" />
        </svg>
      </div>
    </section>
  );
}
