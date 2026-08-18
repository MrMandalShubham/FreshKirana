import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE } from '@/i18n/dictionaries';

/**
 * The locale lives in the URL, so `/` has to choose one.
 *
 * A fixed default rather than Accept-Language sniffing: guessing wrong sends a
 * Hindi speaker to English or the reverse, and the switcher is one tap away.
 * Locale detection belongs with the account preference, once accounts exist.
 */
export default function RootPage() {
  redirect(`/${DEFAULT_LOCALE}`);
}
