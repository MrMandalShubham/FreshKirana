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

export async function markNotificationsRead(): Promise<ActionResult> {
  const result = await sendJson('/me/notifications/read', { method: 'POST' });
  if (!result.ok) return failed(result);

  revalidatePath('/', 'layout');
  return ok;
}
