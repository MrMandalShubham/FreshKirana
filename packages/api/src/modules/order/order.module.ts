import { Module } from '@nestjs/common';

/**
 * Order module - Canonical order and line items, state machine, substitutions, weights.
 *
 * Owns the `order` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class OrderModule {}
