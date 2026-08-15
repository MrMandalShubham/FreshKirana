import { Module } from '@nestjs/common';

/**
 * Payment module - Gateway integration, auth and capture, webhooks, refunds.
 *
 * Owns the `payment` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class PaymentModule {}
