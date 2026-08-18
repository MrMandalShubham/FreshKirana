import { describe, expect, it } from 'vitest';
import { normaliseQuery, normaliseUnits, prepareQuery } from './search';

describe('normaliseQuery', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseQuery('  Aashirvaad   ATTA  ')).toBe('aashirvaad atta');
  });

  it('strips punctuation shoppers type by accident', () => {
    expect(normaliseQuery('atta, 5kg!')).toBe('atta 5kg');
  });

  it('preserves Devanagari', () => {
    // Stripping non-ASCII would silently break every regional-language search.
    expect(normaliseQuery('आटा')).toBe('आटा');
  });

  it('keeps combining marks, which carry the vowel', () => {
    // ा is a mark, not a letter. Stripping it turns आटा (atta) into आट, which
    // matches nothing.
    expect(normaliseQuery('आटा')).toHaveLength(3);
    expect(normaliseQuery('प्याज')).toBe('प्याज');
  });

  it('normalises Devanagari to a single Unicode form', () => {
    // क़ has two valid encodings: the precomposed U+0958, and क + the nukta
    // mark. Android keyboards differ on which they emit, and without NFC the
    // two compare unequal — so a shopper searching क़ीमा would miss a product
    // spelled with the other form.
    const precomposed = 'क़'; // क़
    const decomposed = 'क़'; // क + ़

    expect(precomposed === decomposed).toBe(false);
    expect(normaliseQuery(precomposed)).toBe(normaliseQuery(decomposed));
  });

  it('handles an empty query without throwing', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

describe('normaliseUnits', () => {
  it('collapses spelled-out units', () => {
    expect(normaliseUnits('1 kilo atta')).toBe('1kg atta');
    expect(normaliseUnits('500 grams besan')).toBe('500g besan');
    expect(normaliseUnits('1 litre milk')).toBe('1l milk');
  });

  it('makes spaced and unspaced sizes agree', () => {
    expect(normaliseUnits('5 kg')).toBe(normaliseUnits('5kg'));
  });

  it('leaves ordinary words alone', () => {
    expect(normaliseUnits('tomato ketchup')).toBe('tomato ketchup');
  });
});

describe('prepareQuery', () => {
  it('applies both passes', () => {
    expect(prepareQuery('  Aashirvaad Atta, 5 KILO ')).toBe('aashirvaad atta 5kg');
  });

  it('is idempotent', () => {
    const once = prepareQuery('Tata Salt 1 kg');
    expect(prepareQuery(once)).toBe(once);
  });
});
