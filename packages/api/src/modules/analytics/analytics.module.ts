import { Module } from '@nestjs/common';
import { AnalyticsController } from './internal/analytics.controller';
import { AnalyticsService } from './internal/analytics.service';

/**
 * Analytics module — event ingestion and storage (spec §5).
 *
 * Owns the `analytics` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Exported so every other module can satisfy standing rule R1: a feature ships
 * with its events, or it does not ship.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
