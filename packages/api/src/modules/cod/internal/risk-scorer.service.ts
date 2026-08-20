import { Injectable } from '@nestjs/common';
import {
  CodRiskBand,
  type CodThresholds,
  PaymentMethod,
  type RiskAssessment,
  type RiskInput,
  type RiskScorer,
} from '@freshkirana/contracts';
import { CodConfigService } from './cod-config.service';

/**
 * How much to trust a cash-on-delivery order (spec §2.10.4, §2.17.2).
 *
 * ## Rules on purpose, not as a placeholder
 *
 * §2.17.1 is unusually direct here: rules are *preferable* for COD risk —
 * deterministic, auditable under §3.8, and under 50 ms. A model becomes
 * worthwhile only when §2.17.3's trigger fires: RTO above 3% **and** rule
 * tuning having plateaued.
 *
 * Auditability is the reason this returns every rule that fired. A customer
 * refused cash on delivery is owed an explanation, and "the model said so" is
 * not one.
 *
 * The thresholds come from `CodConfigService` rather than the environment, so
 * they change without a deploy (§2.10.4). P3.4 moved them; the scoring shape is
 * unchanged from P2.7.
 */
@Injectable()
export class RuleRiskScorer implements RiskScorer {
  constructor(private readonly config: CodConfigService) {}

  async score(input: RiskInput): Promise<RiskAssessment> {
    // Prepaid carries no collection risk: the money is already ours.
    if (input.paymentMethod !== PaymentMethod.COD) {
      return {
        band: CodRiskBand.LOW,
        score: 0,
        reasons: ['Prepaid — nothing to collect'],
      };
    }

    const limits = await this.config.current();
    const reasons: string[] = [];
    let score = 0;

    /*
     * A blocked pincode is not a score, it is an answer.
     *
     * These are set because a whole area is undeliverable or has an RTO rate
     * that makes cash unworkable there — a customer with a perfect history
     * cannot make the area deliverable, so no amount of good history should
     * add up to an exception.
     */
    if (limits.blockedPincodes.includes(input.addressPincode)) {
      return {
        band: CodRiskBand.BLOCKED,
        score: 100,
        reasons: ['Cash on delivery is not available in this area'],
      };
    }

    // Returns are the signal that actually predicts returns. Everything else
    // here is a proxy for not knowing the customer yet.
    if (input.rtoCount >= limits.rtoBlockCount) {
      reasons.push(`${input.rtoCount} orders returned undelivered`);
      score += 60;
    } else if (input.rtoCount > 0) {
      reasons.push(`${input.rtoCount} order(s) returned undelivered`);
      score += 25 * input.rtoCount;
    }

    if (input.completedOrderCount === 0) {
      // Not an accusation — simply the case where nothing is known yet.
      reasons.push('First order from this account');
      score += 20;
    } else if (input.completedOrderCount >= 5) {
      reasons.push(`${input.completedOrderCount} orders completed before`);
      score -= 15;
    }

    if (input.orderTotalPaise >= limits.veryHighValuePaise) {
      reasons.push('Unusually large order for cash on delivery');
      score += 30;
    } else if (input.orderTotalPaise >= limits.highValuePaise) {
      reasons.push('Large order for cash on delivery');
      score += 15;
    }

    const bounded = Math.max(0, Math.min(100, score));

    return {
      band: this.bandFor(bounded, limits),
      score: bounded,
      reasons: reasons.length > 0 ? reasons : ['Nothing unusual'],
    };
  }

  private bandFor(score: number, limits: CodThresholds): CodRiskBand {
    if (score >= limits.blockedScore) return CodRiskBand.BLOCKED;
    if (score >= limits.highScore) return CodRiskBand.HIGH;
    if (score >= limits.mediumScore) return CodRiskBand.MEDIUM;
    return CodRiskBand.LOW;
  }
}
