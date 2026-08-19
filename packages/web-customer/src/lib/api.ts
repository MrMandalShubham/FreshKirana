import type { SearchResponse, SearchResultItem } from '@freshkirana/contracts';
import { fetchIdentityToken } from './gcp-auth';
import { getCartToken, getSessionToken } from './session';

/**
 * Read at **runtime**, not inlined at build time.
 *
 * A `NEXT_PUBLIC_` variable is baked into the bundle during `next build`, which
 * would mean one image per environment and a rebuild to repoint the API. Every
 * fetch here happens in a server component, so a plain server-side variable
 * works and one image runs anywhere.
 */
function apiBase(): string {
  return process.env['API_BASE'] ?? 'http://localhost:3000';
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  nameI18n: Record<string, string>;
  parentId: string | null;
  displayOrder: number;
}

export interface MasterProduct {
  id: string;
  slug: string;
  name: string;
  nameI18n: Record<string, string>;
  description: string | null;
  categoryId: string;
  netQuantity: number;
  uom: string;
  isVariableWeight: boolean;
  pricingUom: string | null;
  weightTolerancePct: number;
  isPrepackaged: boolean;
  eanBarcode: string | null;
  hsnCode: string;
  gstRateBp: number;
  vegMark: string;
  manufacturerPacker: string | null;
  countryOfOrigin: string | null;
  consumerCareContact: string | null;
  images: string[];
}

/**
 * Fetch wrapper for the storefront.
 *
 * Returns null on 404 rather than throwing: a missing product is a page state,
 * not an error, and Next's error boundary is the wrong place to handle it.
 * Genuine failures still throw so they surface rather than rendering an empty
 * shop that looks like we have no stock.
 */
async function getJson<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  const base = apiBase();

  const headers: Record<string, string> = { accept: 'application/json' };

  await attachAuth(headers, base);

  const response = await fetch(`${base}${path}`, {
    next: { revalidate: revalidateSeconds },
    headers,
  });

  if (response.status === 404) return null;

  if (response.status === 401 || response.status === 403) {
    // Distinguished deliberately: "the storefront cannot reach the API" and
    // "the product does not exist" look identical as an empty page otherwise,
    // and the first is an outage.
    throw new Error(
      `API ${path} rejected the storefront (${response.status}). ` +
        'Check the web service account holds run.invoker on the API service.',
    );
  }

  if (!response.ok) {
    throw new Error(`API ${path} responded ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * Attaches both identities a request may need.
 *
 * Two of them, and they cannot share a header. Cloud Run's IAM check reads
 * `Authorization`, which is also where the API expects the shopper's token —
 * so the Google identity token goes in `X-Serverless-Authorization`, which
 * Cloud Run consumes and strips, leaving `Authorization` for the application.
 * Putting both in one header authenticates the storefront and logs the shopper
 * out on every request.
 */
async function attachAuth(headers: Record<string, string>, base: string): Promise<void> {
  const identity = await fetchIdentityToken(base);
  const session = await getSessionToken();

  if (identity && session) {
    headers['x-serverless-authorization'] = `Bearer ${identity}`;
    headers['authorization'] = `Bearer ${session}`;
    return;
  }

  if (identity) headers['authorization'] = `Bearer ${identity}`;
  if (session) headers['authorization'] = `Bearer ${session}`;
}

/** What the API answered, without throwing on the ones a screen must handle. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** A message worth showing the shopper, when the API sent one. */
  error: string | null;
  /** Machine-readable code, e.g. CART_VENDOR_CONFLICT or CHECKOUT_BLOCKED. */
  code: string | null;
}

/**
 * A write.
 *
 * Never cached and never revalidated — and unlike `getJson` it does not throw
 * on a 4xx. Every 4xx here is something the shopper can act on: a basket from
 * another shop, a slot that just filled, an address outside the delivery area.
 * Those are screen states, and turning them into exceptions would replace a
 * useful message with an error page.
 */
export async function sendJson<T>(
  path: string,
  init: { method: string; body?: unknown; cartToken?: string | null },
): Promise<ApiResult<T>> {
  const base = apiBase();
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  await attachAuth(headers, base);

  const cartToken = init.cartToken ?? (await getCartToken());
  if (cartToken) headers['x-cart-token'] = cartToken;

  const response = await fetch(`${base}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as
    (Record<string, unknown> & { message?: unknown; code?: unknown }) | null;

  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      data: payload as T,
      error: null,
      code: null,
    };
  }

  return {
    ok: false,
    status: response.status,
    data: null,
    error: messageFrom(payload),
    code: typeof payload?.code === 'string' ? payload.code : null,
  };
}

/** A read that carries the shopper's session and is never cached. */
export async function getPrivateJson<T>(path: string): Promise<ApiResult<T>> {
  return sendJson<T>(path, { method: 'GET' });
}

/**
 * Nest reports validation failures as an array of strings and everything else
 * as one. Joining them beats showing `[object Object]`, which is what a naive
 * read of `message` produces on the most common failure there is.
 */
function messageFrom(payload: { message?: unknown } | null): string | null {
  const message = payload?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message))
    return message.filter((m) => typeof m === 'string').join('. ');
  return null;
}

export async function fetchCategories(): Promise<Category[]> {
  return (await getJson<Category[]>('/catalog/categories', 300)) ?? [];
}

export async function fetchProduct(slug: string): Promise<MasterProduct | null> {
  return getJson<MasterProduct>(`/catalog/products/${encodeURIComponent(slug)}`);
}

/** Price and availability, which live in the search index rather than catalog. */
export async function fetchProductAvailability(
  slug: string,
): Promise<SearchResultItem | null> {
  // Short revalidate: stock changes far more often than product copy (§2.7.4).
  return getJson<SearchResultItem>(`/search/product/${encodeURIComponent(slug)}`, 10);
}

export async function search(query: string, locale: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: '24', locale });
  return (
    (await getJson<SearchResponse>(`/search?${params.toString()}`, 10)) ?? {
      query,
      expandedTerms: [],
      items: [],
      total: 0,
      zeroResult: true,
    }
  );
}

export async function browseCategory(categoryId: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ categoryId, limit: '36' });
  return (
    (await getJson<SearchResponse>(`/search/browse?${params.toString()}`, 30)) ?? {
      query: '',
      expandedTerms: [],
      items: [],
      total: 0,
      zeroResult: true,
    }
  );
}
