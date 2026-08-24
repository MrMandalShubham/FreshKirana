'use client';

import { useState, useTransition } from 'react';
import { markLineOutOfStock, vendorMoveOrder, weighLine } from '@/lib/actions';
import type { OrderLine } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/** What the store can do next, in the order they'd normally do it. */
const STEP_LABEL: Record<string, keyof ReturnType<typeof getDictionary>> = {
  ACCEPTED: 'vendorAccept',
  PICKING: 'vendorStartPicking',
  PACKED: 'vendorMarkPacked',
  READY_FOR_PICKUP: 'vendorReadyForPickup',
};

/**
 * The picking list (§1.7.2).
 *
 * Every line, with one button on each: the shelf was empty. That is the whole
 * picker interaction P4.1 needs — what happens next depends on the customer's
 * preference, and this side deliberately cannot influence it.
 *
 * A line already marked shows its outcome instead of the button, because the
 * useful thing to tell somebody holding a crate is what was decided, not that
 * they already pressed something.
 */
export function PickingList({
  branchId,
  orderId,
  status,
  lines,
  nextActions,
  locale,
}: {
  branchId: string;
  orderId: string;
  status: string;
  lines: OrderLine[];
  nextActions: Array<{ to: string; requiresReason: boolean }>;
  locale: Locale;
}) {
  const t = getDictionary(locale);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Grams typed per line, keyed by line id. */
  const [weights, setWeights] = useState<Record<string, string>>({});

  function move(to: string) {
    setNotice(null);
    setBusy(to);

    startTransition(async () => {
      const form = new FormData();
      form.set('branchId', branchId);
      form.set('orderId', orderId);
      form.set('to', to);

      const result = await vendorMoveOrder(form);
      setBusy(null);
      if (!result.ok) setNotice(result.error ?? t.vendorActionFailed);
    });
  }

  function outOfStock(lineId: string) {
    setNotice(null);
    setBusy(lineId);

    startTransition(async () => {
      const form = new FormData();
      form.set('branchId', branchId);
      form.set('orderId', orderId);
      form.set('lineId', lineId);

      const result = await markLineOutOfStock(form);
      setBusy(null);
      if (!result.ok) setNotice(result.error ?? t.vendorActionFailed);
    });
  }

  /**
   * Records what the scale said (§1.7.1).
   *
   * A weight outside the product's band is not an error — it means the customer
   * has been asked, and the picker should know that rather than see a red
   * message and try again.
   */
  function submitWeight(lineId: string) {
    const grams = Number(weights[lineId] ?? '');
    if (!Number.isFinite(grams) || grams <= 0) return;

    setNotice(null);
    setBusy(lineId);

    startTransition(async () => {
      const form = new FormData();
      form.set('branchId', branchId);
      form.set('orderId', orderId);
      form.set('lineId', lineId);
      form.set('actualGrams', String(Math.round(grams)));

      const result = await weighLine(form);
      setBusy(null);

      if (!result.ok) {
        setNotice(result.error ?? t.vendorActionFailed);
        return;
      }

      setNotice(result.needsConsent ? t.vendorWeightAsked : null);
    });
  }

  // Only the moves the state machine actually allows from here, so a button
  // that would 409 is never drawn (§2.6).
  const steps = nextActions.filter((action) => action.to in STEP_LABEL);

  const canMarkOutOfStock = status === 'PICKING' || status === 'SUBSTITUTION_PENDING';

  return (
    <>
      <section className="section">
        <h2 className="section-title">{t.items}</h2>

        <ul className="order-lines">
          {lines.map((line) => (
            <li key={line.id} className="order-line">
              <span>
                {line.name}
                <span className="muted">
                  {' '}
                  {line.isVariableWeight
                    ? `${line.quantity}${line.uom}`
                    : `× ${line.quantity} · ${line.netQuantity}${line.uom}`}
                  {line.actualGrams !== null &&
                    ` · ${t.vendorWeighed.replace('{grams}', String(line.actualGrams))}`}
                </span>
              </span>

              {line.status === 'PENDING' ? (
                canMarkOutOfStock ? (
                  <span className="picker-actions">
                    {/*
                      Loose goods are weighed, packaged goods are not (§1.7.1).
                      A field on a sealed bag would invite a number that has to
                      be refused.
                    */}
                    {line.isVariableWeight && (
                      <>
                        <input
                          className="input weight"
                          value={weights[line.id] ?? ''}
                          onChange={(event) =>
                            setWeights((current) => ({
                              ...current,
                              [line.id]: event.target.value.replace(/\D/g, ''),
                            }))
                          }
                          inputMode="numeric"
                          placeholder={t.vendorGrams}
                          aria-label={`${t.vendorGrams} — ${line.name}`}
                        />
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => submitWeight(line.id)}
                          disabled={pending || !weights[line.id]}
                        >
                          {busy === line.id ? t.vendorWorking : t.vendorSaveWeight}
                        </button>
                      </>
                    )}

                    <button
                      className="link-button danger"
                      type="button"
                      onClick={() => outOfStock(line.id)}
                      disabled={pending}
                    >
                      {busy === line.id ? t.vendorMarking : t.vendorOutOfStock}
                    </button>
                  </span>
                ) : null
              ) : (
                <span className="muted">{lineOutcome(line.status, t)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {steps.length > 0 && (
        <div className="cart-actions">
          {steps.map((action) => (
            <button
              key={action.to}
              className="button"
              type="button"
              onClick={() => move(action.to)}
              disabled={pending}
            >
              {busy === action.to ? t.vendorWorking : t[STEP_LABEL[action.to]!]}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p className="notice error" role="alert">
          {notice}
        </p>
      )}
    </>
  );
}

function lineOutcome(status: string, t: ReturnType<typeof getDictionary>): string {
  switch (status) {
    case 'OUT_OF_STOCK':
      return t.vendorLineOutOfStock;
    case 'SUBSTITUTED':
      return t.vendorLineSubstituted;
    case 'REFUNDED':
      return t.vendorLineRefunded;
    default:
      return status;
  }
}
