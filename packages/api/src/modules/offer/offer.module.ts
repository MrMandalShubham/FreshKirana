import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { VendorModule } from '../vendor/vendor.module';
import { OfferController } from './internal/offer.controller';
import { OfferService } from './internal/offer.service';
import { RuleSubstituteRanker } from './internal/substitute-ranker.service';

/**
 * Offer module — vendor price, stock and availability (spec §2.4.1).
 *
 * Owns the `offer` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Imports catalog and vendor because, with no cross-schema foreign keys, their
 * services *are* this module's referential integrity — see schema.ts.
 */
@Module({
  imports: [IdentityModule, CatalogModule, VendorModule],
  controllers: [OfferController],
  providers: [OfferService, RuleSubstituteRanker],
  exports: [OfferService, RuleSubstituteRanker],
})
export class OfferModule {}
