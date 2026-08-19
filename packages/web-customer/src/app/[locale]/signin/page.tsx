import { redirect } from 'next/navigation';
import { BottomNav, Header } from '@/components/Chrome';
import { signIn } from '@/lib/actions';
import { devLoginAvailable, isSignedIn } from '@/lib/session';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

export const dynamic = 'force-dynamic';

/**
 * Sign-in — development only, until P8.6.
 *
 * There is no OTP, no password and no account creation: the API issues a token
 * for a seeded customer. This page exists so the ordering flow is testable end
 * to end on a real device, and it is the only screen P8.6 has to replace.
 */
export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  if (await isSignedIn()) redirect(`/${locale}/cart`);

  const available = devLoginAvailable();

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <h1 className="section-title">{t.signIn}</h1>

        {available ? (
          <form
            action={async () => {
              'use server';
              await signIn(locale);
            }}
          >
            <p className="notice">{t.devSignInNotice}</p>
            <button className="button primary wide" type="submit">
              {t.continueAsTestCustomer}
            </button>
          </form>
        ) : (
          <p className="notice error">{t.signInUnavailable}</p>
        )}
      </main>

      <BottomNav locale={locale} current="account" />
    </>
  );
}
