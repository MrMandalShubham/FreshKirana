import { Module } from '@nestjs/common';

/**
 * Cart module - Cart state, substitution preference, validation.
 *
 * Owns the `cart` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class CartModule {}
