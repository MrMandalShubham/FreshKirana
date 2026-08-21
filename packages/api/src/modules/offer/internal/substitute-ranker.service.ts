import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_SUBSTITUTE_OPTIONS,
  type SubstituteCandidate,
  type SubstituteContext,
  type SubstituteRanker,
  refuseSubstitution,
} from '@freshkirana/contracts';
import { and, eq, ne } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { CatalogService } from '../../catalog/contracts';
import { vendorOffer } from '../schema';
import { OfferService } from './offer.service';

/**
 * What to send instead (spec §2.17.2, §1.7.2).
 *
 * ## Rules, not a model — for now
 *
 * §2.17.2 requires this interface to exist in V1 so that adding intelligence is
 * a binding change rather than a refactor. §2.17.3 names the trigger for
 * replacing it: substitution acceptance below 60%, *and* rule tuning having
 * plateaued. Both, and in that order — a model adopted before the rules are
 * exhausted is an expensive way to avoid tuning a query.
 *
 * The rules encode what a shop assistant does without thinking: same kind of
 * thing, nearest size, available today, and don't hand somebody a bigger pack
 * without noting the price went up.
 *
 * The customer-facing substitution flow is P4.1. This is the ranking underneath
 * it, in place from now so the flow has something to call.
 */
@Injectable()
export class RuleSubstituteRanker implements SubstituteRanker {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly offers: OfferService,
    private readonly catalog: CatalogService,
  ) {}

  async rank(context: SubstituteContext): Promise<SubstituteCandidate[]> {
    const wanted = await this.catalog
      .getProduct(context.masterProductId)
      .catch(() => null);
    if (!wanted) return [];

    // Same store only. A substitute from another shop is not a substitute —
    // one order is fulfilled by one store (D2).
    const rows = await this.db
      .select()
      .from(vendorOffer)
      .where(
        and(
          eq(vendorOffer.vendorId, context.vendorId),
          ne(vendorOffer.masterProductId, context.masterProductId),
        ),
      );

    const candidates: SubstituteCandidate[] = [];

    for (const offer of rows) {
      if (!this.offers.isPurchasable(offer)) continue;

      const product = await this.catalog
        .getProduct(offer.masterProductId)
        .catch(() => null);
      if (!product) continue;

      /*
       * The §1.7.2 safety rules, in one place.
       *
       * P2.7 built this ranker with only category, unit and a half-to-double
       * size band — which would happily have offered chicken for paneer, a
       * sealed pack for loose tomatoes, and a 2 kg bag for a 1 kg order. Those
       * are not low-scoring matches to be sorted below better ones; they are
       * refusals, and no amount of similarity elsewhere should outweigh them.
       */
      const refusal = refuseSubstitution({
        original: {
          categoryId: wanted.categoryId,
          netQuantity: wanted.netQuantity,
          uom: wanted.uom,
          vegMark: wanted.vegMark,
          isVariableWeight: wanted.isVariableWeight,
        },
        candidate: {
          categoryId: product.categoryId,
          netQuantity: product.netQuantity,
          uom: product.uom,
          vegMark: product.vegMark,
          isVariableWeight: product.isVariableWeight,
        },
      });
      if (refusal) continue;

      const sizeRatio =
        wanted.netQuantity > 0 ? product.netQuantity / wanted.netQuantity : 0;

      candidates.push({
        vendorOfferId: offer.id,
        masterProductId: offer.masterProductId,
        name: product.name,
        netQuantity: product.netQuantity,
        uom: product.uom,
        sellingPricePaise: offer.sellingPricePaise,
        score: this.score(sizeRatio),
        reason: this.reason(sizeRatio),
      });
    }

    /*
     * Cheaper first among equally good sizes.
     *
     * §1.7.2 never charges more than the original without consent, so a dearer
     * substitute costs the platform the difference. Offering the cheaper of two
     * equal matches is therefore both the customer's preference and ours.
     */
    return candidates
      .sort((a, b) => b.score - a.score || a.sellingPricePaise - b.sellingPricePaise)
      .slice(0, MAX_SUBSTITUTE_OPTIONS);
  }

  /** Closest size wins. Exactly the same size is the ideal, and scores 1. */
  private score(sizeRatio: number): number {
    return Math.round(Math.max(0, 1 - Math.abs(1 - sizeRatio)) * 100) / 100;
  }

  /**
   * Why this was offered, in words.
   *
   * §1.7.2 has the customer approving substitutions, and "similar product" is
   * not something anyone can approve. "Same size, different brand" is.
   */
  private reason(sizeRatio: number): string {
    if (sizeRatio === 1) return 'Same size, different brand';
    if (sizeRatio > 1) return 'A larger pack of the same thing';
    return 'A smaller pack of the same thing';
  }
}
