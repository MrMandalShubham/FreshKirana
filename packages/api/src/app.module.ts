import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OfferModule } from './modules/offer/offer.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { ObservabilityModule } from './observability/observability.module';

/**
 * Application root.
 *
 * Composes the bounded-context modules of spec §2.2. Each owns its own
 * PostgreSQL schema and exposes a published interface in its `contracts.ts`;
 * boundaries are enforced in CI (§2.1.1, rule R2), not by convention.
 *
 * Module stubs exist under `src/modules/` and are registered here as their
 * implementing part lands.
 */
@Module({
  imports: [
    DbModule,
    ObservabilityModule,
    IdentityModule,
    AnalyticsModule,
    CatalogModule,
    VendorModule,
    OfferModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
