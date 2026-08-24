'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sendJson } from './api';
import {
  clearSessionToken,
  devLoginAvailable,
  ensureCartToken,
  getCartToken,
  setSessionToken,
  setThemeChoice,
  type ThemeChoice,
} from './session';

/**
 * Server actions — every write the storefront makes.
 *
 * They run on the server, so the API token never reaches the browser and the
 * pages that read the basket stay server components. Each returns a plain
 * object rather than throwing: a full basket, a filled slot and an address
 * outside the delivery area are all things to *say*, not to crash on.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  code?: string;
  /** Items a bulk add could not take. Reported, never silently dropped. */
  skipped?: number;
}

const ok: ActionResult = { ok: true };

function failed(result: { error: string | null; code: string | null }): ActionResult {
  return {
    ok: false,
    error: result.error ?? 'Something went wrong. Please try again.',
    ...(result.code ? { code: result.code } : {}),
  };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Signs in as a test customer.
 *
 * Development only, mirroring the API's own refusal to expose `/dev/login-as`
 * outside development (P0.3a). Real OTP is P8.6 — when it lands, this action is
 * replaced and nothing else on these screens changes.
 */
export async function signIn(locale: string): Promise<ActionResult> {
  if (!devLoginAvailable()) {
    return { ok: false, error: 'Sign-in is not available in this environment' };
  }

  const result = await sendJson<{ token: string }>('/dev/login-as', {
    method: 'POST',
    body: { role: 'CUSTOMER' },
  });

  if (!result.ok || !result.data?.token) return failed(result);

  await setSessionToken(result.data.token);

  // Hand the basket they filled while anonymous to the account they just used.
  const cartToken = await getCartToken();
  if (cartToken) {
    await sendJson('/cart/claim', { method: 'POST', cartToken });
  }

  revalidatePath('/', 'layout');
  redirect(`/${locale}/cart`);
}

/**
 * Signs in as a shop's staff (P4.1).
 *
 * The vendor's real interface is WhatsApp (§0.3) and the full dashboard is
 * P7.1. This exists because two consecutive parts — substitutions and variable
 * weight — are *started by the picker*, so without a screen their confirmation
 * tests are reachable only from a terminal.
 *
 * Development only, like the customer sign-in, and replaced by P8.6.
 */
export async function signInAsVendor(
  locale: string,
  branchId: string,
): Promise<ActionResult> {
  if (!devLoginAvailable()) {
    return { ok: false, error: 'Sign-in is not available in this environment' };
  }

  const result = await sendJson<{ token: string }>('/dev/login-as', {
    method: 'POST',
    body: { role: 'VENDOR_STAFF', branchId },
  });

  if (!result.ok || !result.data?.token) return failed(result);

  await setSessionToken(result.data.token);

  revalidatePath('/', 'layout');
  redirect(`/${locale}/vendor/${branchId}`);
}

export async function signOut(locale: string): Promise<void> {
  await clearSessionToken();
  revalidatePath('/', 'layout');
  redirect(`/${locale}`);
}

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------

export async function addToCart(formData: FormData): Promise<ActionResult> {
  const vendorOfferId = String(formData.get('vendorOfferId') ?? '');
  const quantityRaw = formData.get('quantity');

  if (!vendorOfferId) return { ok: false, error: 'Nothing to add' };

  // Created here rather than on page render: a server component cannot set a
  // cookie, so the basket id has to be minted by the first write.
  const cartToken = await ensureCartToken();

  const result = await sendJson('/cart/items', {
    method: 'POST',
    cartToken,
    body: {
      vendorOfferId,
      ...(quantityRaw ? { quantity: Number(quantityRaw) } : {}),
    },
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

/**
 * One tap: the whole usual basket into the cart (§0.3, §4.2).
 *
 * Two calls rather than one endpoint, deliberately. The cart knows nothing
 * about prediction and the prediction knows nothing about baskets; joining them
 * here keeps both modules free of the other, and the shopper still taps once.
 *
 * Partial success is a success: a basket that is nine-tenths right is something
 * they can finish, and the skipped count tells them to go and look for the rest.
 */
export async function addUsualBasket(): Promise<ActionResult> {
  const prediction = await sendJson<{
    items: Array<{ vendorOfferId: string; quantity: number }>;
  }>('/me/usual-basket', { method: 'GET' });

  if (!prediction.ok) return failed(prediction);

  const items = prediction.data?.items ?? [];
  if (items.length === 0) return { ok: false, error: 'Nothing to add yet' };

  const result = await sendJson<{ added: string[]; skipped: unknown[] }>(
    '/cart/items/bulk',
    {
      method: 'POST',
      body: {
        items: items.map((item) => ({
          vendorOfferId: item.vendorOfferId,
          quantity: item.quantity,
        })),
      },
    },
  );

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return { ok: true, skipped: result.data?.skipped.length ?? 0 };
}

export async function updateCartQuantity(formData: FormData): Promise<ActionResult> {
  const lineId = String(formData.get('lineId') ?? '');
  const quantity = Number(formData.get('quantity') ?? 0);

  // Zero means remove. A stepper that stops at one leaves the shopper hunting
  // for a separate delete control they cannot see.
  if (quantity <= 0) return removeCartLine(formData);

  const result = await sendJson(`/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    body: { quantity },
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

export async function removeCartLine(formData: FormData): Promise<ActionResult> {
  const lineId = String(formData.get('lineId') ?? '');

  const result = await sendJson(`/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'DELETE',
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

export async function clearCart(): Promise<ActionResult> {
  const result = await sendJson('/cart', { method: 'DELETE' });
  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function saveAddress(formData: FormData): Promise<ActionResult> {
  const body = {
    label: String(formData.get('label') ?? 'HOME'),
    recipientName: String(formData.get('recipientName') ?? ''),
    recipientPhone: String(formData.get('recipientPhone') ?? ''),
    line1: String(formData.get('line1') ?? ''),
    landmark: String(formData.get('landmark') ?? '') || undefined,
    city: String(formData.get('city') ?? ''),
    state: String(formData.get('state') ?? ''),
    pincode: String(formData.get('pincode') ?? ''),
    // The pin decides serviceability, not the text (§2.8.1). Until a map picker
    // exists these come from the form, which is why the API bounds-checks them.
    latitude: Number(formData.get('latitude') ?? 0),
    longitude: Number(formData.get('longitude') ?? 0),
    deliveryNote: String(formData.get('deliveryNote') ?? '') || undefined,
  };

  const result = await sendJson('/me/addresses', { method: 'POST', body });
  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

export async function placeOrder(formData: FormData): Promise<ActionResult> {
  const locale = String(formData.get('locale') ?? 'en');
  const addressId = String(formData.get('addressId') ?? '');
  const slotInstanceId = String(formData.get('slotInstanceId') ?? '');
  const substitutionPreference = String(formData.get('substitutionPreference') ?? '');

  if (!addressId) return { ok: false, error: 'Choose a delivery address' };
  if (!slotInstanceId) return { ok: false, error: 'Choose a delivery slot' };

  const result = await sendJson<{ id: string }>('/checkout/place', {
    method: 'POST',
    body: {
      addressId,
      slotInstanceId,
      ...(substitutionPreference ? { substitutionPreference } : {}),
    },
  });

  if (!result.ok || !result.data?.id) return failed(result);

  revalidatePath('/', 'layout');
  redirect(`/${locale}/orders/${result.data.id}`);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function cancelOrder(formData: FormData): Promise<ActionResult> {
  const orderId = String(formData.get('orderId') ?? '');
  const reason = String(formData.get('reason') ?? '') || undefined;

  const result = await sendJson(`/me/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: { reason },
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

// ---------------------------------------------------------------------------
// Payment recovery (P3.3)
// ---------------------------------------------------------------------------

/**
 * What a failed payment can be turned into.
 *
 * The intent comes back to the *server* action and is handed to the browser
 * only as the two fields Razorpay Checkout needs. There is no path here that
 * marks an order paid — that is the webhook's job, and putting it in reach of
 * a browser would make "paid" something a customer could assert.
 */
export interface PaymentIntentResult extends ActionResult {
  providerOrderId?: string;
  keyId?: string;
  amountPaise?: number;
}

export async function retryPayment(formData: FormData): Promise<PaymentIntentResult> {
  const orderId = String(formData.get('orderId') ?? '');

  const result = await sendJson<{ providerOrderId: string; amountPaise: number }>(
    `/me/orders/${encodeURIComponent(orderId)}/payment/retry`,
    { method: 'POST' },
  );

  if (!result.ok || !result.data) return failed(result);

  return {
    ok: true,
    providerOrderId: result.data.providerOrderId,
    amountPaise: result.data.amountPaise,
    ...(process.env['RAZORPAY_KEY_ID'] ? { keyId: process.env['RAZORPAY_KEY_ID'] } : {}),
  };
}

export async function convertOrderToCod(formData: FormData): Promise<ActionResult> {
  const orderId = String(formData.get('orderId') ?? '');

  const result = await sendJson(
    `/me/orders/${encodeURIComponent(orderId)}/payment/convert-to-cod`,
    { method: 'POST' },
  );

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

// ---------------------------------------------------------------------------
// Cash on delivery confirmation (P3.4)
// ---------------------------------------------------------------------------

export interface VerifyCodResult extends ActionResult {
  /** Wrong-code tries remaining, when that is why it failed. */
  attemptsLeft?: number;
  reason?: string;
}

export async function confirmCodOrder(formData: FormData): Promise<ActionResult> {
  const orderId = String(formData.get('orderId') ?? '');

  const result = await sendJson(`/me/orders/${encodeURIComponent(orderId)}/cod/confirm`, {
    method: 'POST',
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

export async function declineCodOrder(formData: FormData): Promise<ActionResult> {
  const orderId = String(formData.get('orderId') ?? '');

  const result = await sendJson(`/me/orders/${encodeURIComponent(orderId)}/cod/decline`, {
    method: 'POST',
  });

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

/**
 * Checks the code the customer read off their phone.
 *
 * A wrong code is a 201 carrying `ok: false`, not an error — "that is not
 * right, three tries left" is information they need, and an exception carries
 * it badly.
 */
export async function verifyCodOtp(formData: FormData): Promise<VerifyCodResult> {
  const orderId = String(formData.get('orderId') ?? '');
  const code = String(formData.get('code') ?? '').trim();

  const result = await sendJson<{
    ok: boolean;
    reason?: string;
    attemptsLeft?: number;
  }>(`/me/orders/${encodeURIComponent(orderId)}/cod/verify`, {
    method: 'POST',
    body: { code },
  });

  if (!result.ok) return failed(result);

  if (result.data?.ok) {
    revalidatePath('/', 'layout');
    return ok;
  }

  return {
    ok: false,
    ...(result.data?.reason ? { reason: result.data.reason } : {}),
    ...(result.data?.attemptsLeft !== undefined
      ? { attemptsLeft: result.data.attemptsLeft }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The picker (P4.1, §1.7.2)
// ---------------------------------------------------------------------------

/** Moves an order along, as the store. Accept, start picking, mark packed. */
export async function vendorMoveOrder(formData: FormData): Promise<ActionResult> {
  const branchId = String(formData.get('branchId') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const to = String(formData.get('to') ?? '');

  const result = await sendJson(
    `/vendor/${encodeURIComponent(branchId)}/orders/${encodeURIComponent(orderId)}/transitions`,
    { method: 'POST', body: { to } },
  );

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

/**
 * The shelf was empty (§1.7.2).
 *
 * What happens next is the customer's preference, not the picker's choice —
 * this hands the fact over and the API decides. A picker who could choose would
 * be deciding for somebody who already said what they wanted.
 */
export async function markLineOutOfStock(formData: FormData): Promise<ActionResult> {
  const branchId = String(formData.get('branchId') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const lineId = String(formData.get('lineId') ?? '');

  const result = await sendJson(
    `/vendor/${encodeURIComponent(branchId)}/orders/${encodeURIComponent(orderId)}` +
      `/lines/${encodeURIComponent(lineId)}/out-of-stock`,
    { method: 'POST' },
  );

  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

/**
 * What the scale said (P4.2, §1.7.1).
 *
 * Returns the outcome rather than only success, because "that is outside the
 * band, we have asked the customer" is the answer a picker most needs to see —
 * and it is not a failure.
 */
export interface WeighResult extends ActionResult {
  actualLineTotalPaise?: number;
  deltaPaise?: number;
  needsConsent?: boolean;
  absorbed?: boolean;
}

export async function weighLine(formData: FormData): Promise<WeighResult> {
  const branchId = String(formData.get('branchId') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const lineId = String(formData.get('lineId') ?? '');
  const actualGrams = Number(formData.get('actualGrams') ?? 0);
  const consented = formData.get('consented') === 'true';

  const result = await sendJson<{
    actualLineTotalPaise: number;
    deltaPaise: number;
    needsConsent: boolean;
    absorbed: boolean;
  }>(
    `/vendor/${encodeURIComponent(branchId)}/orders/${encodeURIComponent(orderId)}` +
      `/lines/${encodeURIComponent(lineId)}/weight`,
    { method: 'POST', body: consented ? { actualGrams, consented } : { actualGrams } },
  );

  if (!result.ok || !result.data) return failed(result);

  revalidatePath('/', 'layout');

  return {
    ok: true,
    actualLineTotalPaise: result.data.actualLineTotalPaise,
    deltaPaise: result.data.deltaPaise,
    needsConsent: result.data.needsConsent,
    absorbed: result.data.absorbed,
  };
}

export async function markNotificationsRead(): Promise<ActionResult> {
  const result = await sendJson('/me/notifications/read', { method: 'POST' });
  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}

/**
 * Switches between the light and dark grounds (§4.5).
 *
 * A form post rather than a click handler, so the choice works before any
 * JavaScript has loaded — the same reason search is a plain GET form. The
 * layout re-reads the cookie on the next render, so the whole app changes at
 * once instead of one screen at a time.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const value = formData.get('theme');
  if (value !== 'light' && value !== 'dark') return;

  await setThemeChoice(value as ThemeChoice);
  revalidatePath('/', 'layout');
}
