import { Injectable } from '@nestjs/common';
import {
  CodRiskBand,
  PaymentMethod,
  type RiskAssessment,
  type RiskInput,
  type RiskScorer,
} from '@freshkirana/contracts';

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
 * The confirmation flow this feeds — thresholds, WhatsApp confirmation, the
 * ops overrides — is P3.4. This is the scoring underneath it, in place from
 * now so that part has something to call.
 */
@Injectable()
export class RuleRiskScorer implements RiskScorer {
  /** Thresholds are configuration (§7.5): a pilot city tunes them weekly. */
  private get thresholds() {
    return {
      highValuePaise: this.fromEnv('COD_HIGH_VALUE_PAISE', 300_000),
      veryHighValuePaise: this.fromEnv('COD_VERY_HIGH_VALUE_PAISE', 500_000),
      rtoCountBlocked: this.fromEnv('COD_RTO_BLOCK_COUNT', 3),
    };
  }

  score(input: RiskInput): Promise<RiskAssessment> {
    // Prepaid carries no collection risk: the money is already ours.
    if (input.paymentMethod !== PaymentMethod.COD) {
      return Promise.resolve({
        band: CodRiskBand.LOW,
        score: 0,
        reasons: ['Prepaid — nothing to collect'],
      });
    }

    const limits = this.thresholds;
    const reasons: string[] = [];
    let score = 0;

    // Returns are the signal that actually predicts returns. Everything else
    // here is a proxy for not knowing the customer yet.
    if (input.rtoCount >= limits.rtoCountBlocked) {
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

    return Promise.resolve({
      band: this.bandFor(bounded),
      score: bounded,
      reasons: reasons.length > 0 ? reasons : ['Nothing unusual'],
    });
  }

  private bandFor(score: number): string {
    if (score >= 70) return CodRiskBand.BLOCKED;
    if (score >= 40) return CodRiskBand.HIGH;
    if (score >= 20) return CodRiskBand.MEDIUM;
    return CodRiskBand.LOW;
  }

  private fromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
