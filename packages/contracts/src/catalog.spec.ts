import { describe, expect, it } from 'vitest';
import {
  GST_RATE_BP,
  gstRateBpToPercent,
  isPlausibleGstRateBp,
  isValidEan,
  isValidHsnCode,
  missingLegalMetrologyFields,
} from './catalog';

describe('GST rates', () => {
  it('converts basis points to percent exactly', () => {
    expect(gstRateBpToPercent(GST_RATE_BP.FIVE)).toBe(5);
    expect(gstRateBpToPercent(GST_RATE_BP.EIGHTEEN)).toBe(18);
    expect(gstRateBpToPercent(GST_RATE_BP.EXEMPT)).toBe(0);
  });

  it('accepts plausible rates including zero', () => {
    expect(isPlausibleGstRateBp(0)).toBe(true);
    expect(isPlausibleGstRateBp(2800)).toBe(true);
  });

  it('rejects fractional basis points and absurd rates', () => {
    expect(isPlausibleGstRateBp(500.5)).toBe(false);
    expect(isPlausibleGstRateBp(-100)).toBe(false);
    expect(isPlausibleGstRateBp(9999)).toBe(false);
  });
});

describe('HSN codes', () => {
  it('accepts 4, 6 and 8 digit codes', () => {
    expect(isValidHsnCode('1006')).toBe(true);
    expect(isValidHsnCode('100630')).toBe(true);
    expect(isValidHsnCode('10063010')).toBe(true);
  });

  it('rejects other shapes', () => {
    expect(isValidHsnCode('100')).toBe(false);
    expect(isValidHsnCode('10063')).toBe(false);
    expect(isValidHsnCode('1006301X')).toBe(false);
    expect(isValidHsnCode('')).toBe(false);
  });
});

describe('EAN codes', () => {
  it('accepts EAN-8, UPC-A and EAN-13', () => {
    expect(isValidEan('96385074')).toBe(true);
    expect(isValidEan('012345678905')).toBe(true);
    expect(isValidEan('8901058000221')).toBe(true);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidEan('12345')).toBe(false);
    expect(isValidEan('89010580002211')).toBe(false);
    expect(isValidEan('890105800022X')).toBe(false);
  });
});

describe('Legal Metrology declarations (§3.7.3)', () => {
  const complete = {
    isPrepackaged: true,
    manufacturerPacker: 'ITC Limited, Kolkata',
    countryOfOrigin: 'India',
    consumerCareContact: 'care@example.com',
  };

  it('passes a complete pre-packaged product', () => {
    expect(missingLegalMetrologyFields(complete)).toEqual([]);
  });

  it('names every missing declaration', () => {
    expect(missingLegalMetrologyFields({ ...complete, countryOfOrigin: null })).toEqual([
      'countryOfOrigin',
    ]);

    expect(
      missingLegalMetrologyFields({
        isPrepackaged: true,
        manufacturerPacker: null,
        countryOfOrigin: null,
        consumerCareContact: null,
      }).sort(),
    ).toEqual(['consumerCareContact', 'countryOfOrigin', 'manufacturerPacker']);
  });

  it('treats whitespace as missing', () => {
    expect(
      missingLegalMetrologyFields({ ...complete, manufacturerPacker: '   ' }),
    ).toEqual(['manufacturerPacker']);
  });

  it('exempts loose goods, which are not pre-packaged', () => {
    // Tomatoes weighed at the counter carry no packaged-commodity declarations.
    expect(
      missingLegalMetrologyFields({
        isPrepackaged: false,
        manufacturerPacker: null,
        countryOfOrigin: null,
        consumerCareContact: null,
      }),
    ).toEqual([]);
  });
});
