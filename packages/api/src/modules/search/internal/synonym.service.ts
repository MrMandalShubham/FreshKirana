import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { prepareQuery } from '@freshkirana/contracts';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { synonym } from '../schema';

export const SynonymKind = {
  TRANSLITERATION: 'TRANSLITERATION',
  REGIONAL_NAME: 'REGIONAL_NAME',
  BRAND: 'BRAND',
  CATEGORY: 'CATEGORY',
  MISSPELLING: 'MISSPELLING',
} as const;

/**
 * Query expansion (spec §2.7.2).
 *
 * Expansion is per-token, not per-phrase: "kanda tamatar" must expand both
 * words, and a shopper rarely types a phrase we anticipated.
 */
@Injectable()
export class SynonymService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Expands a normalised query into every term worth matching.
   *
   * Always includes the original tokens: expansion adds reach, it never
   * replaces what the shopper actually typed.
   */
  async expand(normalisedQuery: string, locale?: string): Promise<string[]> {
    const tokens = normalisedQuery.split(' ').filter(Boolean);
    if (tokens.length === 0) return [];

    const rows = await this.db
      .select({ term: synonym.term, expansions: synonym.expansions })
      .from(synonym)
      .where(
        and(
          eq(synonym.isActive, true),
          locale
            ? or(isNull(synonym.locale), eq(synonym.locale, locale))
            : isNull(synonym.locale),
        ),
      );

    /**
     * Expansion is **bidirectional**.
     *
     * A row saying `atta → [aata, आटा]` must also make a search for `आटा` reach
     * atta. Requiring ops to author the reverse of every entry is how a
     * dictionary silently rots: someone adds `kanda → onion`, nobody adds the
     * reverse, and Marathi shoppers can find onions while Hindi ones searching
     * the English name cannot.
     *
     * So each row is treated as a set of equivalent terms — the term plus its
     * expansions — and matching any member yields all of them.
     */
    const groups: string[][] = rows.map((row) => [
      prepareQuery(row.term),
      // Expansions are authored by ops, so normalise them the same way the
      // query was — otherwise "Wheat Flour" never matches anything.
      ...row.expansions.map((expansion) => prepareQuery(expansion)),
    ]);

    const expanded = new Set<string>(tokens);
    for (const token of tokens) {
      for (const group of groups) {
        // A group member may be multi-word ("wheat flour"); match on the whole
        // member or any of its words.
        const matches = group.some(
          (member) => member === token || member.split(' ').includes(token),
        );
        if (!matches) continue;

        for (const member of group) {
          for (const part of member.split(' ').filter(Boolean)) {
            expanded.add(part);
          }
        }
      }
    }

    return [...expanded];
  }

  async create(input: {
    term: string;
    expansions: string[];
    locale?: string;
    kind?: string;
    createdByAccountId?: string;
  }) {
    const term = prepareQuery(input.term);

    try {
      const rows = await this.db
        .insert(synonym)
        .values({
          term,
          expansions: input.expansions.map((e) => e.trim()).filter(Boolean),
          locale: input.locale ?? null,
          kind: input.kind ?? SynonymKind.REGIONAL_NAME,
          createdByAccountId: input.createdByAccountId ?? null,
        })
        .returning();
      return rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          `A synonym for "${term}" already exists${input.locale ? ` in ${input.locale}` : ''} — update it instead`,
        );
      }
      throw error;
    }
  }

  async list(locale?: string) {
    return this.db
      .select()
      .from(synonym)
      .where(locale ? eq(synonym.locale, locale) : undefined)
      .orderBy(asc(synonym.term));
  }

  async setActive(id: string, isActive: boolean) {
    const rows = await this.db
      .update(synonym)
      .set({ isActive })
      .where(eq(synonym.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Seed terms for the launch city (§2.7.2).
   *
   * Small on purpose. The real dictionary is grown weekly from failed searches
   * (§2.7.4) — guessing it up front is how you end up with a list that reflects
   * the team's vocabulary rather than the shoppers'.
   */
  async seedDefaults(): Promise<{ inserted: number }> {
    const defaults: Array<{ term: string; expansions: string[]; kind: string }> = [
      {
        term: 'atta',
        expansions: ['aata', 'आटा', 'wheat flour', 'gehun'],
        kind: SynonymKind.TRANSLITERATION,
      },
      {
        term: 'aata',
        expansions: ['atta', 'आटा', 'wheat flour'],
        kind: SynonymKind.TRANSLITERATION,
      },
      {
        term: 'kanda',
        expansions: ['onion', 'pyaz', 'प्याज'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      {
        term: 'pyaz',
        expansions: ['onion', 'kanda', 'प्याज'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      {
        term: 'bhindi',
        expansions: ['okra', 'ladies finger', 'भिंडी'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      { term: 'jeera', expansions: ['cumin', 'जीरा'], kind: SynonymKind.REGIONAL_NAME },
      {
        term: 'dhaniya',
        expansions: ['coriander', 'धनिया'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      {
        term: 'methi',
        expansions: ['fenugreek', 'मेथी'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      {
        term: 'haldi',
        expansions: ['turmeric', 'हल्दी'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      {
        term: 'tamatar',
        expansions: ['tomato', 'टमाटर'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      { term: 'aloo', expansions: ['potato', 'आलू'], kind: SynonymKind.REGIONAL_NAME },
      { term: 'chawal', expansions: ['rice', 'चावल'], kind: SynonymKind.REGIONAL_NAME },
      { term: 'doodh', expansions: ['milk', 'दूध'], kind: SynonymKind.REGIONAL_NAME },
      {
        term: 'cheeni',
        expansions: ['sugar', 'chini', 'चीनी'],
        kind: SynonymKind.REGIONAL_NAME,
      },
      { term: 'namak', expansions: ['salt', 'नमक'], kind: SynonymKind.REGIONAL_NAME },
      { term: 'tel', expansions: ['oil', 'तेल'], kind: SynonymKind.REGIONAL_NAME },
      {
        term: 'dal',
        expansions: ['daal', 'lentil', 'pulses', 'दाल'],
        kind: SynonymKind.TRANSLITERATION,
      },
      {
        term: 'besan',
        expansions: ['gram flour', 'बेसन'],
        kind: SynonymKind.TRANSLITERATION,
      },
    ];

    let inserted = 0;
    for (const entry of defaults) {
      const result = await this.db
        .insert(synonym)
        .values({
          term: entry.term,
          expansions: entry.expansions,
          kind: entry.kind,
          locale: null,
        })
        .onConflictDoNothing()
        .returning({ id: synonym.id });
      inserted += result.length;
    }

    return { inserted };
  }
}
