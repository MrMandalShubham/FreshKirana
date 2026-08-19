import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { CodModule } from './modules/cod/cod.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrderModule } from './modules/order/order.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OfferModule } from './modules/offer/offer.module';
import { SearchModule } from './modules/search/search.module';
import { ServiceabilityModule } from './modules/serviceability/serviceability.module';
import { UserModule } from './modules/user/user.module';
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
    UserModule,
    CatalogModule,
    VendorModule,
    OfferModule,
    SearchModule,
    ServiceabilityModule,
    PricingModule,
    CartModule,
    OrderModule,
    CheckoutModule,
    CodModule,
    InventoryModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
