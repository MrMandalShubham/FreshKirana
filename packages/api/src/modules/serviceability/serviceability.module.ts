import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdentityModule } from '../identity/identity.module';
import { BranchModule } from '../branch/branch.module';
import { ServiceAreaService } from './internal/service-area.service';
import { ServiceabilityController } from './internal/serviceability.controller';
import { SlotService } from './internal/slot.service';
import { BranchServiceabilityController } from './internal/branch-serviceability.controller';

/**
 * Serviceability module — geofences, store resolution, slots and capacity
 * (spec §2.8).
 *
 * Owns the `serviceability` PostgreSQL schema. Other modules may import only
 * from `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Deliberately knows nothing about orders. Checkout (P2.3) books a slot through
 * the published contract, in the same transaction as its stock reservation —
 * this module's job ends at "one place taken, atomically".
 */
@Module({
  imports: [IdentityModule, BranchModule, AnalyticsModule],
  controllers: [ServiceabilityController, BranchServiceabilityController],
  providers: [ServiceAreaService, SlotService],
  exports: [ServiceAreaService, SlotService],
})
export class ServiceabilityModule {}
