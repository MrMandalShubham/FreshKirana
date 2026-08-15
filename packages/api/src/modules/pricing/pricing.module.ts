import { Module } from '@nestjs/common';

/**
 * Pricing module - Selling price rules, discounts, coupons, delivery/MOV/packaging fees.
 *
 * Owns the `pricing` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class PricingModule {}
