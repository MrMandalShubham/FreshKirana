import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { OfferModule } from '../offer/offer.module';
import { SearchAdminController, SearchController } from './internal/search.controller';
import { SearchIndexService } from './internal/search-index.service';
import { SearchService } from './internal/search.service';
import { SynonymService } from './internal/synonym.service';

/**
 * Search module — query expansion, ranking and the search index (spec §2.7).
 *
 * Owns the `search` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * The engine is PostgreSQL (`pg_trgm` plus a denormalised projection) rather
 * than Typesense. Tuning a dedicated engine against an empty catalog is
 * premature, and the genuinely hard part — Indian-language expansion — is
 * engine-independent. §2.1.2 names the trigger to revisit: catalog above 200K
 * offers, or search p95 above 200 ms.
 */
@Module({
  imports: [IdentityModule, CatalogModule, OfferModule, AnalyticsModule],
  controllers: [SearchController, SearchAdminController],
  providers: [SearchService, SynonymService, SearchIndexService],
  exports: [SearchService, SearchIndexService, SynonymService],
})
export class SearchModule {}
