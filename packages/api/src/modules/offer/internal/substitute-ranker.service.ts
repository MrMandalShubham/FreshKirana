import { Inject, Injectable } from '@nestjs/common';
import {
  type SubstituteCandidate,
  type SubstituteContext,
  type SubstituteRanker,
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

      // A different category is a different thing. Nobody accepts rice for oil.
      if (product.categoryId !== wanted.categoryId) continue;
      if (product.uom !== wanted.uom) continue;

      const sizeRatio =
        wanted.netQuantity > 0 ? product.netQuantity / wanted.netQuantity : 0;

      // Half to double. Outside that it is not the same purchase, whatever the
      // category says.
      if (sizeRatio < 0.5 || sizeRatio > 2) continue;

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

    return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
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
