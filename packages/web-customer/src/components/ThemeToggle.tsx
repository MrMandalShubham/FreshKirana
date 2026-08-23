import { setTheme } from '@/lib/actions';
import { type ThemeChoice } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * Light or dark, as a choice rather than only a system preference.
 *
 * Two plain form buttons, not a toggle switch. A switch has to say which way
 * is "on", which is meaningless for a pair of equals — and it would need
 * JavaScript to work, where these post and re-render.
 *
 * `current` is null until the shopper picks one, and that state is real: it
 * means "follow the phone", which is the sensible default and the one most
 * people never change.
 */
export function ThemeToggle({
  current,
  locale,
}: {
  current: ThemeChoice | null;
  locale: Locale;
}) {
  const t = getDictionary(locale);

  const options: Array<{ value: ThemeChoice; label: string }> = [
    { value: 'light', label: t.themeLight },
    { value: 'dark', label: t.themeDark },
  ];

  return (
    <form action={setTheme} className="theme-toggle">
      {options.map((option) => (
        <button
          key={option.value}
          type="submit"
          name="theme"
          value={option.value}
          // `aria-pressed` rather than `aria-current`: these are controls that
          // change a setting, not links to a place.
          aria-pressed={current === option.value}
        >
          {option.label}
        </button>
      ))}

      {current === null && <span className="muted">{t.themeFollowingPhone}</span>}
    </form>
  );
}
