import { Module } from '@nestjs/common';

/**
 * Ledger module - Double-entry ledger - the financial source of truth.
 *
 * Owns the `ledger` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class LedgerModule {}
