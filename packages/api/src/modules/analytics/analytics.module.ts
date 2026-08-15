import { Module } from '@nestjs/common';

/**
 * Analytics module - Event ingestion, warehouse sync, KPI surfaces.
 *
 * Owns the `analytics` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class AnalyticsModule {}
