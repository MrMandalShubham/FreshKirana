import { Module } from '@nestjs/common';

/**
 * Checkout module - Orchestration: validate, reserve, price, tax, pay, create order.
 *
 * Owns the `checkout` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class CheckoutModule {}
