'use client';

import { useActionState, useState } from 'react';
import { SubstitutionPreference } from '@freshkirana/contracts';
import { placeOrder, saveAddress, type ActionResult } from '@/lib/actions';
import { inr } from '@/lib/money';
import type { Address, CheckoutPreview, Slot } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * Checkout: address → slot → substitution preference → COD → review → place.
 *
 * One screen rather than a wizard. A kirana order is four decisions, and each
 * extra page is somewhere to abandon — §4.2 puts the whole thing in front of
 * the shopper with the total always visible.
 */
export function CheckoutForm({
  locale,
  preview,
  addresses,
  slots,
}: {
  locale: Locale;
  preview: CheckoutPreview | null;
  addresses: Address[];
  slots: Slot[];
}) {
  const t = getDictionary(locale);

  const [addressId, setAddressId] = useState(
    preview?.address?.id ??
      addresses.find((a) => a.isDefault)?.id ??
      addresses[0]?.id ??
      '',
  );
  const [slotId, setSlotId] = useState(preview?.slot?.id ?? '');
  const [substitution, setSubstitution] = useState<string>(
    preview?.cart.substitutionPreference ?? SubstitutionPreference.AUTO_SUBSTITUTE,
  );

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => placeOrder(formData),
    null,
  );

  const totals = preview?.totals;

  // Blockers the shopper cannot act on from here are still worth showing —
  // "this store does not deliver to that address" explains a disabled button
  // that would otherwise look broken.
  const blockers = (preview?.blockers ?? []).filter(
    (blocker) => blocker.code !== 'SLOT_REQUIRED' || slotId === '',
  );

  return (
    <form action={formAction} className="checkout">
      <input type="hidden" name="locale" value={locale} />

      <section className="checkout-section">
        <h2 className="section-title">{t.deliveryAddress}</h2>

        {addresses.length === 0 ? (
          <AddressForm locale={locale} />
        ) : (
          <ul className="option-list">
            {addresses.map((address) => (
              <li key={address.id}>
                <label className="option">
                  <input
                    type="radio"
                    name="addressId"
                    value={address.id}
                    checked={addressId === address.id}
                    onChange={() => setAddressId(address.id)}
                  />
                  <span>
                    <strong>{address.recipientName}</strong>
                    <span className="muted">
                      {address.line1}, {address.city} {address.pincode}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="checkout-section">
        <h2 className="section-title">{t.deliverySlot}</h2>

        {slots.length === 0 ? (
          <p className="empty">{t.noSlots}</p>
        ) : (
          <ul className="option-list">
            {slots.map((slot) => (
              <li key={slot.id}>
                {/*
                  Full and closed slots are shown greyed rather than hidden
                  (§2.8.2). A slot that disappears reads as a bug; a greyed one
                  with the next available beneath it reads as information.
                */}
                <label className={`option${slot.isBookable ? '' : ' disabled'}`}>
                  <input
                    type="radio"
                    name="slotInstanceId"
                    value={slot.id}
                    checked={slotId === slot.id}
                    disabled={!slot.isBookable}
                    onChange={() => setSlotId(slot.id)}
                  />
                  <span>
                    <strong>{formatDate(slot.serviceDate)}</strong>
                    <span className="muted">
                      {slot.label}
                      {slot.isBookable ? '' : ` · ${statusLabel(slot.status, t)}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="checkout-section">
        <h2 className="section-title">{t.ifSomethingIsOut}</h2>

        <ul className="option-list chips">
          {[
            { value: SubstitutionPreference.AUTO_SUBSTITUTE, label: t.substituteAuto },
            { value: SubstitutionPreference.ASK_ME, label: t.substituteAsk },
            { value: SubstitutionPreference.REFUND_ITEM, label: t.substituteRefund },
          ].map((option) => (
            <li key={option.value}>
              <label className="option">
                <input
                  type="radio"
                  name="substitutionPreference"
                  value={option.value}
                  checked={substitution === option.value}
                  onChange={() => setSubstitution(option.value)}
                />
                <span>{option.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="checkout-section">
        <h2 className="section-title">{t.payment}</h2>
        {/* COD only until the gateway lands (P3.2). Saying so beats a disabled
            row of payment methods that looks broken. */}
        <p className="notice">{t.codOnly}</p>
      </section>

      {totals && (
        <section className="totals" aria-label={t.orderSummary}>
          <p className="totals-row">
            <span>{t.itemsTotal}</span>
            <span>{inr(totals.subtotalPaise)}</span>
          </p>
          <p className="totals-row">
            <span>{t.deliveryFee}</span>
            <span>
              {totals.deliveryFeePaise === 0 ? t.free : inr(totals.deliveryFeePaise)}
            </span>
          </p>
          {totals.smallBasketFeePaise > 0 && (
            <p className="totals-row">
              <span>{t.smallBasketFee}</span>
              <span>{inr(totals.smallBasketFeePaise)}</span>
            </p>
          )}
          <p className="totals-row">
            <span>{t.packagingFee}</span>
            <span>{inr(totals.packagingFeePaise)}</span>
          </p>
        </section>
      )}

      {blockers.map((blocker) => (
        <p key={blocker.code} className="notice error" role="alert">
          {blocker.message}
        </p>
      ))}

      {state?.ok === false && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}

      {/*
        Sticky, because the price and the button that commits to it should
        never be a scroll apart on a phone. `position: sticky` rather than
        `fixed` so it settles into the page at the end rather than covering it.
      */}
      <div className="paybar">
        <span className="amount">
          <span className="k">{t.payOnDelivery}</span>
          <span className="v">{totals ? inr(totals.grandTotalPaise) : '—'}</span>
        </span>

        <button
          className="button primary"
          type="submit"
          disabled={pending || !addressId || !slotId}
        >
          {pending ? t.placingOrder : t.placeOrder}
        </button>
      </div>
    </form>
  );
}

/**
 * A new address.
 *
 * Latitude and longitude are typed in, which is not how a real shopper should
 * ever enter them — a map pin is the right control and needs a geocoding
 * provider, which is a paid program dependency (deferred at P2.2). Until then
 * this is honest about what it is rather than pretending to geocode.
 */
function AddressForm({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => saveAddress(formData),
    null,
  );

  return (
    <div className="address-form">
      <p className="muted">{t.noAddresses}</p>

      <div className="field-grid">
        <Field
          name="recipientName"
          label={t.recipientName}
          form="address-form"
          required
        />
        <Field
          name="recipientPhone"
          label={t.phone}
          form="address-form"
          placeholder="+919812345678"
          required
        />
        <Field name="line1" label={t.addressLine} form="address-form" required />
        <Field name="landmark" label={t.landmark} form="address-form" />
        <Field name="city" label={t.city} form="address-form" required />
        <Field name="state" label={t.state} form="address-form" required />
        <Field name="pincode" label={t.pincode} form="address-form" required />
        <Field name="latitude" label={t.latitude} form="address-form" required />
        <Field name="longitude" label={t.longitude} form="address-form" required />
      </div>

      {state?.ok === false && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}

      {/* Its own form element, outside the checkout form: nesting forms is
          invalid HTML and the browser silently drops the inner one. */}
      <form id="address-form" action={formAction} />
      <button className="button" type="submit" form="address-form" disabled={pending}>
        {pending ? t.saving : t.saveAddress}
      </button>
    </div>
  );
}

function Field({
  name,
  label,
  form,
  required,
  placeholder,
}: {
  name: string;
  label: string;
  form: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        name={name}
        form={form}
        required={required}
        placeholder={placeholder}
      />
    </label>
  );
}

function statusLabel(status: string, t: ReturnType<typeof getDictionary>): string {
  if (status === 'FULL') return t.slotFull;
  if (status === 'BLACKOUT') return t.slotClosed;
  return t.slotCutoffPassed;
}

function formatDate(serviceDate: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${serviceDate}T06:00:00Z`));
}
