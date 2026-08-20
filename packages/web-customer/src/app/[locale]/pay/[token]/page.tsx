import Link from 'next/link';
import { PayWithLink } from '@/components/PayWithLink';
import { getPrivateJson } from '@/lib/api';
import { inr } from '@/lib/money';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The "finish paying" link (§2.10.3 step 2).
 *
 * Deliberately outside the signed-in shell: this arrives over WhatsApp and is
 * opened on whichever device is to hand, often not the one that started the
 * checkout. Demanding a sign-in here loses exactly the order the link exists to
 * save.
 *
 * So it shows no header, no bottom navigation and nothing about the customer —
 * an amount and a way to pay it. The token in the URL is a bearer credential,
 * and a page that rendered a name and address would turn a forwarded message
 * into a privacy leak.
 */
export const dynamic = 'force-dynamic';

interface LinkView {
  usable: boolean;
  reason?: string;
  amountPaise?: number;
  providerOrderId?: string;
  keyId?: string | null;
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ locale: Locale; token: string }>;
}) {
  const { locale, token } = await params;
  const t = getDictionary(locale);

  const result = await getPrivateJson<LinkView>(`/pay/${encodeURIComponent(token)}`);
  const link = result.data;

  if (!link?.usable || !link.providerOrderId || !link.amountPaise) {
    return (
      <main id="main" className="container">
        <h1 className="section-title">{t.paymentLinkDead}</h1>
        <p>{t.paymentLinkDeadHelp}</p>
        <Link className="link-button" href={`/${locale}/orders`}>
          {t.allOrders}
        </Link>
      </main>
    );
  }

  return (
    <main id="main" className="container">
      <h1 className="section-title">{t.paymentAmount}</h1>
      <p className="totals-row total">
        <span>{inr(link.amountPaise)}</span>
      </p>

      <PayWithLink
        providerOrderId={link.providerOrderId}
        amountPaise={link.amountPaise}
        keyId={link.keyId ?? null}
        locale={locale}
      />
    </main>
  );
}
