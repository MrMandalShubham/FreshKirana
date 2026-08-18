import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { OfferModule } from '../offer/offer.module';
import { AdminCatalogController } from './internal/admin-catalog.controller';

/**
 * Admin module — backoffice orchestration over the other modules (spec §2.2).
 *
 * Owns no tables of its own. It exists so that workflows spanning several
 * bounded contexts have a home that does not force a dependency cycle: approving
 * a product request touches catalog *and* offer, and offer already depends on
 * catalog.
 */
@Module({
  imports: [IdentityModule, CatalogModule, OfferModule],
  controllers: [AdminCatalogController],
})
export class AdminModule {}
