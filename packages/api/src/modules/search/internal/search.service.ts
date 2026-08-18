import { Inject, Injectable } from '@nestjs/common';
import {
  type MatchReason,
  type SearchResponse,
  type SearchResultItem,
  prepareQuery,
} from '@freshkirana/contracts';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { SynonymService } from './synonym.service';

/** Below this, a trigram match is noise rather than a near-miss. */
const FUZZY_THRESHOLD = 0.28;

/** A "did you mean" suggestion needs to be closer than a search result. */
const SUGGESTION_THRESHOLD = 0.35;

/** Snake_case because these come straight from a raw query, not the ORM. */
interface IndexRow extends Record<string, unknown> {
  master_product_id: string;
  slug: string;
  name: string;
  brand: string | null;
  category_id: string;
  net_quantity: number;
  uom: string;
  veg_mark: string;
  image_url: string | null;
  min_price_paise: number | null;
  mrp_paise: number | null;
  is_available: boolean;
  offer_count: number;
  score: number;
  contains: boolean;
}

/**
 * Customer-facing search (spec §2.7).
 *
 * Ranking follows §2.7.3, and the order of the sort keys is the substance:
 *
 *  1. **Availability first.** An out-of-stock product never outranks one you
 *     can actually buy. Grocery shoppers are filling a basket, not browsing;
 *     a perfect match nobody stocks is a worse result than a good match in
 *     stock.
 *  2. Substring containment before fuzzy score, so a shopper who types the
 *     product's actual name gets it top.
 *  3. Vendors keeping true stock counts (§1.9.2 QUANTITY mode) rank above
 *     those on a simple toggle — the incentive that migrates vendors upward.
 *  4. Cheapest last, as the tie-break.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly synonyms: SynonymService,
  ) {}

  async search(input: {
    query: string;
    limit?: number;
    offset?: number;
    categoryId?: string;
    locale?: string;
  }): Promise<SearchResponse> {
    const limit = Math.min(input.limit ?? 20, 50);
    const offset = input.offset ?? 0;

    const normalised = prepareQuery(input.query);
    if (normalised === '') {
      return {
        query: input.query,
        expandedTerms: [],
        items: [],
        total: 0,
        zeroResult: true,
      };
    }

    const expandedTerms = await this.synonyms.expand(normalised, input.locale);
    // The full phrase matters too: "tata salt" should beat products matching
    // only "salt".
    const terms = [...new Set([normalised, ...expandedTerms])];

    /**
     * Terms are passed as one delimited string, not a JS array.
     *
     * Drizzle expands an array into a parenthesised parameter list, which
     * Postgres reads as a record — `cannot cast type record to text[]`.
     * `string_to_array` keeps it a single bound parameter. A comma is a safe
     * delimiter because prepareQuery has already stripped punctuation.
     */
    const termList = terms.join(',');

    const rows = await this.db.execute<IndexRow>(sql`
      select
        pi.master_product_id, pi.slug, pi.name, pi.brand, pi.category_id,
        pi.net_quantity, pi.uom, pi.veg_mark, pi.image_url,
        pi.min_price_paise, pi.mrp_paise, pi.is_available, pi.offer_count,
        (select max(similarity(pi.search_text, t)) from unnest(string_to_array(${termList}, ',')) as t) as score,
        (select bool_or(pi.search_text like '%' || t || '%') from unnest(string_to_array(${termList}, ',')) as t) as contains
      from search.product_index pi
      where pi.product_status = 'ACTIVE'
        ${input.categoryId ? sql`and pi.category_id = ${input.categoryId}` : sql``}
        and (
          (select bool_or(pi.search_text like '%' || t || '%') from unnest(string_to_array(${termList}, ',')) as t)
          or (select max(similarity(pi.search_text, t)) from unnest(string_to_array(${termList}, ',')) as t) > ${FUZZY_THRESHOLD}
        )
      order by
        pi.is_available desc,
        contains desc,
        score desc nulls last,
        pi.quantity_mode_offer_count desc,
        pi.min_price_paise asc nulls last
      limit ${limit} offset ${offset}
    `);

    const items = rows.rows.map((row) => this.toItem(row, normalised));

    if (items.length === 0) {
      const didYouMean = await this.suggestCorrection(normalised);
      return {
        query: input.query,
        expandedTerms: terms,
        items: [],
        total: 0,
        zeroResult: true,
        ...(didYouMean ? { didYouMean } : {}),
      };
    }

    return {
      query: input.query,
      expandedTerms: terms,
      items,
      total: items.length,
      zeroResult: false,
    };
  }

  /**
   * Autocomplete. Availability-first for the same reason as full search, and
   * capped tight because a suggestion list is scanned, not read.
   */
  async suggest(
    query: string,
    limit = 8,
  ): Promise<Array<{ name: string; slug: string }>> {
    const normalised = prepareQuery(query);
    if (normalised.length < 2) return [];

    const rows = await this.db.execute<{ name: string; slug: string }>(sql`
      select pi.name, pi.slug
      from search.product_index pi
      where pi.product_status = 'ACTIVE'
        and pi.search_text like ${`%${normalised}%`}
      order by pi.is_available desc, pi.offer_count desc, length(pi.name) asc
      limit ${Math.min(limit, 20)}
    `);

    return rows.rows;
  }

  /**
   * A correction worth retrying, or nothing (§2.7.4).
   *
   * Only offered on a zero-result search: suggesting a correction for a query
   * that already worked is noise.
   */
  private async suggestCorrection(normalised: string): Promise<string | undefined> {
    const rows = await this.db.execute<{ name: string; score: number }>(sql`
      select pi.name, similarity(pi.name, ${normalised}) as score
      from search.product_index pi
      where pi.product_status = 'ACTIVE'
        and similarity(pi.name, ${normalised}) > ${SUGGESTION_THRESHOLD}
      order by score desc
      limit 1
    `);

    return rows.rows[0]?.name;
  }

  private toItem(row: IndexRow, normalised: string): SearchResultItem {
    return {
      masterProductId: row.master_product_id,
      slug: row.slug,
      name: row.name,
      brand: row.brand,
      categoryId: row.category_id,
      netQuantity: row.net_quantity,
      uom: row.uom,
      vegMark: row.veg_mark,
      imageUrl: row.image_url,
      minPricePaise: row.min_price_paise,
      mrpPaise: row.mrp_paise,
      isAvailable: row.is_available,
      offerCount: row.offer_count,
      score: Number(row.score ?? 0),
      matchReason: this.matchReasonFor(row, normalised),
    };
  }

  private matchReasonFor(row: IndexRow, normalised: string): MatchReason {
    if (row.name.toLowerCase() === normalised) return 'EXACT';
    if (row.contains) return 'FULL_TEXT';
    // Reached only via an expanded term, since the raw query did not contain.
    return Number(row.score ?? 0) > FUZZY_THRESHOLD ? 'FUZZY' : 'SYNONYM';
  }
}
