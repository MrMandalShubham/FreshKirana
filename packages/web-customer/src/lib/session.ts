import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';

/**
 * The shopper's session, such as it is until P8.6.
 *
 * There is no real authentication yet — the API issues tokens through a
 * development-only login. So this stores whatever the API gave us in an
 * HttpOnly cookie and sends it back. When OTP lands, the cookie handling here
 * stays and only the way the token is obtained changes.
 *
 * HttpOnly because a token readable by JavaScript is a token an injected script
 * can take, and there is no reason for the browser's JS to see it at all: every
 * call to the API happens on the server.
 */
const SESSION_COOKIE = 'fk_session';

/**
 * The anonymous basket.
 *
 * A shopper fills a cart before signing in (§1.5.1) — demanding a login first
 * loses them at the top of the funnel. This id is what the API's cart module
 * calls `x-cart-token`, and it is claimed by the account on sign-in.
 */
const CART_COOKIE = 'fk_cart';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure everywhere except local http, where the cookie would be dropped.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSessionToken(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSessionToken()) !== null;
}

/** The anonymous basket id, if one has been issued. */
export async function getCartToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

/**
 * The basket id, creating one on first use.
 *
 * Only call this from a server action — a page render cannot set cookies in
 * Next, and a basket that silently fails to persist is worse than one that
 * starts a moment later.
 */
export async function ensureCartToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const token = `cart-${randomUUID()}`;
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: YEAR_SECONDS,
  });

  return token;
}

/**
 * Whether the development sign-in is available.
 *
 * The API refuses `/dev/login-as` outside development, so offering the button
 * in production would render a control that can only fail. This mirrors that
 * decision rather than guessing at it.
 */
export function devLoginAvailable(): boolean {
  return process.env['ALLOW_DEV_LOGIN'] === 'true';
}
