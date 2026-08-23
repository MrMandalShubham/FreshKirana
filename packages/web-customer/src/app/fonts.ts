import { Bricolage_Grotesque, Manrope } from 'next/font/google';

/**
 * The two typefaces (§4.2).
 *
 * `next/font` downloads and self-hosts these at build time, so the browser
 * never contacts Google and there is no third-party request to block, cache or
 * consent to. It also emits the `size-adjust` metrics for the fallback, which
 * is what stops the layout shifting when the real face arrives.
 *
 * Latin only. The shell is English, and Indian staples keep the names people
 * actually type — atta, toor dal, haldi — so no Devanagari range is loaded.
 *
 * Four weights total, deliberately. Every extra weight is another file on a
 * mid-range phone over 4G, and the scale below never asks for a fifth.
 */

export const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '800'],
  variable: '--font-display',
  display: 'swap',
  // Only headings use it, so a brief fallback is invisible where it matters.
  preload: false,
});

export const body = Manrope({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-body',
  display: 'swap',
});
