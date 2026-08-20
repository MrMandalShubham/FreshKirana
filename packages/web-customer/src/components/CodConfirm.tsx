'use client';

import { useState, useTransition } from 'react';
import { confirmCodOrder, declineCodOrder, verifyCodOtp } from '@/lib/actions';
import type { CodConfirmation } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

const OTP_LENGTH = 6;

/**
 * Confirming a cash order (§2.10.4).
 *
 * The customer opened the app to find out what is happening to their order, so
 * this says it plainly: the shop has not been told yet, and it will not be told
 * until they answer. Everything above it on the page — the timeline, the
 * items — is still true, but none of it is the thing they need to do.
 *
 * The same two answers as the WhatsApp message, because a shopper who missed
 * the message, or deleted it, or never had WhatsApp on this phone, must still
 * be able to finish. Whichever arrives first wins; the other becomes a no-op.
 */
export function CodConfirm({
  orderId,
  confirmation,
  phone,
  locale,
}: {
  orderId: string;
  confirmation: CodConfirmation;
  phone: string;
  locale: Locale;
}) {
  const t = getDictionary(locale);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<'yes' | 'no' | 'code' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const needsCode = confirmation.method === 'OTP';

  function act(
    which: 'yes' | 'no',
    run: (form: FormData) => Promise<{ ok: boolean; error?: string }>,
  ) {
    setNotice(null);
    setBusy(which);

    startTransition(async () => {
      const form = new FormData();
      form.set('orderId', orderId);

      const result = await run(form);
      setBusy(null);

      if (!result.ok) setNotice(result.error ?? t.codOtpExpired);
      // On success the action revalidates and this whole block disappears with
      // the PENDING_PAYMENT status that produced it.
    });
  }

  function submitCode() {
    setNotice(null);
    setBusy('code');

    startTransition(async () => {
      const form = new FormData();
      form.set('orderId', orderId);
      form.set('code', code);

      const result = await verifyCodOtp(form);
      setBusy(null);

      if (result.ok) return;

      setCode('');

      if (result.reason === 'TOO_MANY_ATTEMPTS') {
        setNotice(t.codOtpNoTries);
      } else if (result.reason === 'EXPIRED' || result.reason === 'NOT_PENDING') {
        setNotice(t.codOtpExpired);
      } else {
        setNotice(t.codOtpWrong.replace('{left}', String(result.attemptsLeft ?? 0)));
      }
    });
  }

  return (
    <section className="section notice warning" aria-live="polite">
      <h2 className="section-title">{t.codConfirmTitle}</h2>
      <p>{t.codConfirmHelp}</p>

      {confirmation.expiresAt && (
        <p className="muted">
          {t.codExpiresAt.replace('{time}', formatTime(confirmation.expiresAt, locale))}
        </p>
      )}

      {needsCode ? (
        <>
          <p>
            {t.codOtpHelp
              .replace('{length}', String(OTP_LENGTH))
              .replace('{phone}', maskPhone(phone))}
          </p>

          <label className="field">
            <span>{t.codOtpLabel}</span>
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              // The right keyboard on a phone, and the OS offers the code from
              // the message rather than making them switch apps to read it.
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              aria-label={t.codOtpLabel}
            />
          </label>

          <div className="cart-actions">
            <button
              className="button"
              type="button"
              onClick={submitCode}
              disabled={pending || code.length !== OTP_LENGTH}
            >
              {busy === 'code' ? t.codConfirming : t.codOtpSubmit}
            </button>

            <button
              className="link-button danger"
              type="button"
              onClick={() => act('no', declineCodOrder)}
              disabled={pending}
            >
              {busy === 'no' ? t.codCancelling : t.codConfirmNo}
            </button>
          </div>
        </>
      ) : (
        <div className="cart-actions">
          <button
            className="button"
            type="button"
            onClick={() => act('yes', confirmCodOrder)}
            disabled={pending}
          >
            {busy === 'yes' ? t.codConfirming : t.codConfirmYes}
          </button>

          <button
            className="link-button danger"
            type="button"
            onClick={() => act('no', declineCodOrder)}
            disabled={pending}
          >
            {busy === 'no' ? t.codCancelling : t.codConfirmNo}
          </button>
        </div>
      )}

      {notice && (
        <p className="notice error" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}

/**
 * The last two digits only.
 *
 * Enough for the customer to recognise which phone the code went to, and not
 * enough to be worth anything to somebody looking over their shoulder.
 */
function maskPhone(phone: string): string {
  return phone.length > 2 ? `••••${phone.slice(-2)}` : phone;
}

function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
