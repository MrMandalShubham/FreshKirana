import type { SearchResponse, SearchResultItem } from '@freshkirana/contracts';
import { fetchIdentityToken } from './gcp-auth';

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

  // The API is IAM-private until P8.6, so on Cloud Run every call carries an
  // identity token. Locally this is null and the header is omitted.
  const token = await fetchIdentityToken(base);
  if (token) headers['authorization'] = `Bearer ${token}`;

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
