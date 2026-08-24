import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { BranchModule } from '../branch/branch.module';
import { BatchController, ShelfLifeSweepController } from './internal/batch.controller';
import { OfferController } from './internal/offer.controller';
import { OfferService } from './internal/offer.service';
import { BatchService } from './internal/batch.service';
import { RecallRegistry } from './internal/recall.registry';
import { RuleSubstituteRanker } from './internal/substitute-ranker.service';

/**
 * Offer module — branch price, stock and availability (spec §2.4.1).
 *
 * Owns the `offer` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Imports catalog and branch because, with no cross-schema foreign keys, their
 * services *are* this module's referential integrity — see schema.ts.
 */
@Module({
  imports: [IdentityModule, CatalogModule, BranchModule],
  controllers: [OfferController, BatchController, ShelfLifeSweepController],
  providers: [OfferService, RuleSubstituteRanker, BatchService, RecallRegistry],
  exports: [OfferService, RuleSubstituteRanker, BatchService, RecallRegistry],
})
export class OfferModule {}
