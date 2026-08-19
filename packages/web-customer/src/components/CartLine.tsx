'use client';

import { useActionState } from 'react';
import { UOM_LABEL, type Uom } from '@freshkirana/contracts';
import { removeCartLine, updateCartQuantity, type ActionResult } from '@/lib/actions';
import { inr } from '@/lib/money';
import type { CartLine as Line } from '@/lib/orders';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * One basket line, with a stepper that respects the product's unit (§4.2).
 *
 * Packaged goods step one pack at a time; loose goods step in the amount a
 * person actually asks for — 250 g of jeera, not 1 g. The step comes from the
 * API rather than being guessed here, so the cart and the picker's scale agree.
 */
export function CartLineRow({ line, locale }: { line: Line; locale: Locale }) {
  const t = getDictionary(locale);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) =>
      formData.get('intent') === 'remove'
        ? removeCartLine(formData)
        : updateCartQuantity(formData),
    null,
  );

  const unit = UOM_LABEL[line.uom as Uom] ?? line.uom.toLowerCase();
  const isMeasured = line.quantityMode === 'MEASURE';

  const decremented = Math.max(0, line.quantity - line.quantityStep);
  const incremented = line.quantity + line.quantityStep;

  return (
    <li className={`cart-line${line.isAvailable ? '' : ' unavailable'}`}>
      <div className="cart-line-main">
        <p className="product-name">{line.name}</p>
        <p className="muted">
          {isMeasured
            ? `${line.quantity} ${unit}`
            : `${line.netQuantity} ${unit} × ${line.quantity}`}
        </p>

        {!line.isAvailable && (
          // Shown, not silently dropped: a line that vanishes lets a shopper
          // reach the door believing they ordered something they did not.
          <p className="notice error">{t.itemUnavailable}</p>
        )}

        {line.priceChanged && line.isAvailable && (
          <p className="notice">{t.priceChanged}</p>
        )}
      </div>

      <form action={formAction} className="cart-line-controls">
        <input type="hidden" name="lineId" value={line.id} />

        <div className="stepper">
          <button
            className="stepper-button"
            type="submit"
            name="quantity"
            value={decremented}
            disabled={pending}
            aria-label={decremented === 0 ? t.remove : t.decrease}
          >
            −
          </button>

          <span className="stepper-value" aria-live="polite">
            {isMeasured ? `${line.quantity} ${unit}` : line.quantity}
          </span>

          <button
            className="stepper-button"
            type="submit"
            name="quantity"
            value={incremented}
            disabled={pending}
            aria-label={t.increase}
          >
            +
          </button>
        </div>

        <p className="price">{inr(line.lineTotalPaise)}</p>

        <button
          className="link-button"
          type="submit"
          name="intent"
          value="remove"
          disabled={pending}
        >
          {t.remove}
        </button>

        {state?.ok === false && (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </li>
  );
}
