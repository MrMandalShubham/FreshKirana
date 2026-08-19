import { Money, type Paise } from '@freshkirana/contracts';

/**
 * Formats integer paise for display.
 *
 * Money is a branded type so arithmetic cannot mix it with plain numbers by
 * accident (§2.3), which is worth the one cast — kept here so it happens once
 * rather than at every price on every screen.
 */
export function inr(paise: number): string {
  return Money.formatINR(paise as Paise);
}
