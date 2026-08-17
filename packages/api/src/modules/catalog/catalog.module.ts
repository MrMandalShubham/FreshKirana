import { Module } from '@nestjs/common';
import { CatalogController } from './internal/catalog.controller';
import { CatalogService } from './internal/catalog.service';

/**
 * Catalog module — master products, categories, brands (spec §2.4.1).
 *
 * Owns the `catalog` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Implements decision D1. The `offer` module (P1.2) attaches vendor price and
 * stock to these products; `search` (P1.4) indexes them.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
