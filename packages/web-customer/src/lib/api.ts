import type { SearchResponse, SearchResultItem } from '@freshkirana/contracts';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE'] ?? 'http://localhost:3000';

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
  const response = await fetch(`${API_BASE}${path}`, {
    next: { revalidate: revalidateSeconds },
    headers: { accept: 'application/json' },
  });

  if (response.status === 404) return null;
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
