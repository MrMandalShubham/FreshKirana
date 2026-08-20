import { describe, expect, it } from 'vitest';
import {
  CodConfirmationMethod,
  DEFAULT_COD_THRESHOLDS,
  confirmationFor,
  validateThresholds,
} from './cod';
import { CodRiskBand } from './payment-status';

describe('what each band demands (§2.10.4)', () => {
  it('lets a trusted order through untouched', () => {
    expect(confirmationFor(CodRiskBand.LOW)).toBe(CodConfirmationMethod.NONE);
  });

  it('asks for one tap in the middle band', () => {
    expect(confirmationFor(CodRiskBand.MEDIUM)).toBe(CodConfirmationMethod.QUICK_REPLY);
  });

  it('asks for a code when a tap is not enough', () => {
    // A tapped button proves somebody has the phone. A code read off it and
    // typed back proves they are looking at it now.
    expect(confirmationFor(CodRiskBand.HIGH)).toBe(CodConfirmationMethod.OTP);
  });

  it('covers every band, so a new one cannot be silently unhandled', () => {
    for (const band of Object.values(CodRiskBand)) {
      expect(confirmationFor(band)).toBeDefined();
    }
  });
});

describe('where the defaults sit', () => {
  it("leaves a new customer's first small order alone", () => {
    // The scorer gives "first order from this account" exactly 20. A medium
    // cutoff at 20 would put every new customer through a WhatsApp
    // confirmation on their first cash order — friction at the precise moment
    // §0.3 is trying to win them over.
    expect(DEFAULT_COD_THRESHOLDS.mediumScore).toBeGreaterThan(20);
  });
});

describe('thresholds people edit by hand', () => {
  it('accepts the defaults', () => {
    expect(validateThresholds(DEFAULT_COD_THRESHOLDS)).toEqual([]);
  });

  it('refuses cutoffs that do not climb', () => {
    // Otherwise a band becomes unreachable and nobody notices until the RTO
    // number moves, weeks later.
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      mediumScore: 50,
      highScore: 40,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('must increase');
  });

  it('refuses an rtoBlockCount of zero, which would block everybody', () => {
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      rtoBlockCount: 0,
    });

    expect(problems).toHaveLength(1);
  });

  it('refuses a value band that is inverted', () => {
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      highValuePaise: 600_000,
      veryHighValuePaise: 500_000,
    });

    expect(problems).toHaveLength(1);
  });

  it('refuses a window so short nobody could answer', () => {
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      confirmationWindowMinutes: 0,
    });

    expect(problems).toHaveLength(1);
  });

  it('refuses a mistyped PIN code', () => {
    // A typo here silently stops blocking a pincode that ops believe is
    // blocked, which is worse than the edit failing loudly.
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      blockedPincodes: ['560001', '5600', '060001'],
    });

    expect(problems).toHaveLength(2);
  });

  it('reports every problem at once, not the first', () => {
    // Somebody fixing these is editing a form, and one error at a time turns
    // one edit into four round trips.
    const problems = validateThresholds({
      ...DEFAULT_COD_THRESHOLDS,
      mediumScore: 90,
      rtoBlockCount: 0,
      confirmationWindowMinutes: 0,
    });

    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});
