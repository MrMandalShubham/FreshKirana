import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdentityModule } from '../identity/identity.module';
import { CodConfigService } from './internal/cod-config.service';
import { CodConfirmationService } from './internal/cod-confirmation.service';
import { CodThresholdsController } from './internal/cod-thresholds.controller';
import { RuleRiskScorer } from './internal/risk-scorer.service';

/**
 * COD module — risk scoring, confirmation, and the audit trail (spec §2.10.4).
 *
 * Owns the `cod` PostgreSQL schema: the thresholds ops turn, every risk
 * decision made, and every confirmation ceremony.
 *
 * Deliberately knows nothing about orders beyond an id. Moving an order is the
 * order module's job — a cod module that could transition orders would be a
 * second place where fulfilment state changes, and §2.6 has exactly one.
 */
@Module({
  imports: [IdentityModule, AnalyticsModule],
  controllers: [CodThresholdsController],
  providers: [CodConfigService, CodConfirmationService, RuleRiskScorer],
  exports: [CodConfigService, CodConfirmationService, RuleRiskScorer],
})
export class CodModule {}
