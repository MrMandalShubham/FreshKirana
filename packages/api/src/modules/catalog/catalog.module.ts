import { Module } from '@nestjs/common';

/**
 * Catalog module - Master products, categories, attributes, HSN/GST mapping, moderation.
 *
 * Owns the `catalog` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class CatalogModule {}
