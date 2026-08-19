import { Module } from '@nestjs/common';
import { RuleRiskScorer } from './internal/risk-scorer.service';

/**
 * COD module — risk scoring, confirmation, recovery (spec §2.10.4).
 *
 * Owns the `cod` PostgreSQL schema, which it does not use yet: the risk
 * *scorer* is here from P2.7 because rule R3 requires the three §2.17.2
 * interfaces to exist with rule implementations behind them. The confirmation
 * flow and its tables arrive with P3.4.
 */
@Module({
  providers: [RuleRiskScorer],
  exports: [RuleRiskScorer],
})
export class CodModule {}
