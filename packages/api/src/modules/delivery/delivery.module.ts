import { Module } from '@nestjs/common';

/**
 * Delivery module - Fulfilment provider abstraction, assignment, tracking, POD, RTO.
 *
 * Owns the `delivery` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class DeliveryModule {}
