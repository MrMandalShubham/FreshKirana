import { Module } from '@nestjs/common';

/**
 * Serviceability module - Geofences, store-to-address resolution, slot definitions and capacity.
 *
 * Owns the `serviceability` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class ServiceabilityModule {}
