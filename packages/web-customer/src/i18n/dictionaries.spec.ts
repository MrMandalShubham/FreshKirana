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
    expect(isLocale('hi')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('../etc/passwd')).toBe(false);
  });

  it('translates every key in every locale', () => {
    // A missing key renders as `undefined` on the page rather than failing
    // loudly, so completeness is asserted rather than trusted.
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
  it('prefers the translation for the current locale', () => {
    expect(localisedName('Wheat Flour', { hi: 'आटा' }, 'hi')).toBe('आटा');
  });

  it('falls back to the canonical name when untranslated', () => {
    expect(localisedName('Wheat Flour', { mr: 'कणीक' }, 'hi')).toBe('Wheat Flour');
    expect(localisedName('Wheat Flour', {}, 'hi')).toBe('Wheat Flour');
    expect(localisedName('Wheat Flour', null, 'hi')).toBe('Wheat Flour');
  });

  it('ignores a blank translation rather than rendering an empty name', () => {
    // A half-filled translation column is normal in a real catalog.
    expect(localisedName('Wheat Flour', { hi: '   ' }, 'hi')).toBe('Wheat Flour');
  });
});
