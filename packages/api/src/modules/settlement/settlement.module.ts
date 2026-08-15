import { Module } from '@nestjs/common';

/**
 * Settlement module - Payout cycles, reconciliation, COD cash, vendor statements.
 *
 * Owns the `settlement` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class SettlementModule {}
