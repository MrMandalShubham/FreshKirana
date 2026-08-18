/**
 * Authenticating to the API from Cloud Run.
 *
 * The API service is IAM-private and stays that way until P8.6 ships real
 * authentication, so the storefront cannot simply fetch it — an unauthenticated
 * request gets 403. On Cloud Run the runtime service account can mint an
 * identity token from the metadata server, scoped to the API's URL as audience.
 *
 * This runs **server-side only**. If a client component ever imports the API
 * layer, this would be bundled and always take the "not on Cloud Run" path,
 * which would look like a puzzling 403 in production.
 */

/** Cloud Run always sets K_SERVICE; nothing else here does. */
export function isRunningOnCloudRun(): boolean {
  return Boolean(process.env['K_SERVICE']);
}

const METADATA_HOST = 'http://metadata.google.internal';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/** Refresh this long before expiry, so a token never expires mid-flight. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * An identity token for `audience`, cached until shortly before it expires.
 *
 * Tokens last about an hour. Fetching one per request would add a metadata
 * round trip to every page render for no benefit.
 */
export async function fetchIdentityToken(audience: string): Promise<string | null> {
  if (!isRunningOnCloudRun()) return null;

  const cached = cache.get(audience);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  try {
    const url = `${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
    const response = await fetch(url, {
      headers: { 'Metadata-Flavor': 'Google' },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const token = (await response.text()).trim();
    if (!token) return null;

    cache.set(audience, {
      token,
      expiresAt: expiryOf(token) - REFRESH_MARGIN_MS,
    });

    return token;
  } catch {
    // Metadata unreachable. Returning null lets the caller fail with the real
    // API error rather than a confusing metadata error.
    return null;
  }
}

/** Reads `exp` from the JWT payload, falling back to a conservative 30 minutes. */
function expiryOf(token: string): number {
  const fallback = Date.now() + 30 * 60 * 1000;
  try {
    const payload = token.split('.')[1];
    if (!payload) return fallback;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };

    return decoded.exp ? decoded.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}
