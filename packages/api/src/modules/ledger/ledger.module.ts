import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  LedgerController,
  LedgerIntegrityController,
} from './internal/ledger.controller';
import { LedgerService } from './internal/ledger.service';

/**
 * Ledger module — double-entry bookkeeping (spec §2.4.4, rule R5).
 *
 * Owns the `ledger` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Imports nothing but identity. That is deliberate: the ledger records what
 * happened to money and must not depend on anything that could make it refuse
 * to record. Vendor and rider ids arrive as opaque scope strings, unvalidated
 * here on purpose — a payable that cannot be written because a vendor lookup
 * timed out is money lost from the books.
 */
@Module({
  imports: [IdentityModule],
  controllers: [LedgerController, LedgerIntegrityController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
