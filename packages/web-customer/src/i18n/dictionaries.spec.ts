import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getDictionary,
  isLocale,
  localisedName,
} from './dictionaries';

describe('locales', () => {
  it('recognises supported locales and rejects others', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('hi')).toBe(false);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('../etc/passwd')).toBe(false);
  });

  it('translates every key in every locale', () => {
    // A missing key renders as `undefined` on the page rather than failing
    // loudly, so completeness is asserted rather than trusted. With one locale
    // this guards the shape the next locale would have to match.
    const english = getDictionary('en');
    for (const locale of LOCALES) {
      const dictionary = getDictionary(locale);
      for (const key of Object.keys(english) as Array<keyof typeof english>) {
        expect(dictionary[key], `${locale} is missing "${key}"`).toBeTruthy();
      }
    }
  });

  it('falls back to the default for an unknown locale', () => {
    expect(getDictionary('xx' as never)).toEqual(getDictionary(DEFAULT_LOCALE));
  });
});

describe('localisedName', () => {
  /*
   * The shell is English-only, but the catalogue column stays: product names
   * are the half of translation that actually matters in grocery, and a second
   * locale should not need this rewritten.
   */
  it('prefers the translation for the current locale', () => {
    expect(localisedName('Wheat Flour', { en: 'Atta' }, 'en')).toBe('Atta');
  });

  it('falls back to the canonical name when untranslated', () => {
    expect(localisedName('Wheat Flour', { mr: 'Kanik' }, 'en')).toBe('Wheat Flour');
    expect(localisedName('Wheat Flour', {}, 'en')).toBe('Wheat Flour');
    expect(localisedName('Wheat Flour', null, 'en')).toBe('Wheat Flour');
  });

  it('ignores a blank translation rather than rendering an empty name', () => {
    // A half-filled translation column is normal in a real catalog.
    expect(localisedName('Wheat Flour', { en: '   ' }, 'en')).toBe('Wheat Flour');
  });
});
