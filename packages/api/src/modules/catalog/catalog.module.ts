import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CatalogImportService } from './internal/catalog-import.service';
import { CatalogController } from './internal/catalog.controller';
import { CatalogService } from './internal/catalog.service';
import { DuplicateDetector } from './internal/duplicate-detector';
import { ProductRequestController } from './internal/product-request.controller';
import { ProductRequestService } from './internal/product-request.service';

/**
 * Catalog module — master products, categories, brands, and the product-request
 * queue (spec §2.4.1, §1.9.1).
 *
 * Owns the `catalog` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Implements decision D1. Note what is *absent*: this module never imports
 * offer. Offer depends on catalog, so the reverse would close a cycle — which
 * is why request approval is orchestrated from the admin module.
 */
@Module({
  imports: [IdentityModule],
  controllers: [CatalogController, ProductRequestController],
  providers: [
    CatalogService,
    DuplicateDetector,
    ProductRequestService,
    CatalogImportService,
  ],
  exports: [
    CatalogService,
    DuplicateDetector,
    ProductRequestService,
    CatalogImportService,
  ],
})
export class CatalogModule {}
