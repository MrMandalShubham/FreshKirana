import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { OfferModule } from '../offer/offer.module';
import { PricingModule } from '../pricing/pricing.module';
import { CartController } from './internal/cart.controller';
import { CartService } from './internal/cart.service';

/**
 * Cart module — the shopper's basket (spec §1.5.1, §4.2).
 *
 * Owns the `cart` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Prices every line from `offer` on read rather than trusting the snapshot it
 * stores, and asks `pricing` for fees so cart, checkout and settlement cannot
 * disagree about what a basket costs.
 */
@Module({
  imports: [IdentityModule, OfferModule, CatalogModule, PricingModule, AnalyticsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
