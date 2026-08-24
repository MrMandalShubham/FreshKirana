import { Controller, Get, Post, Query } from '@nestjs/common';
import { Role, isLedgerAccount, type LedgerAccount } from '@freshkirana/contracts';
import { BadRequestException } from '@nestjs/common';
import { Roles } from '../../identity/contracts';
import { LedgerService } from './ledger.service';

/**
 * Reading the books (spec §2.4.4).
 *
 * Read-only, and finance-facing. There is deliberately no endpoint that posts
 * an arbitrary journal entry: postings come from the events that caused them,
 * so that every number can be traced to something that actually happened. A
 * correction is an ADJUSTMENT posted by the service that owns the mistake.
 */
@Roles(Role.ADMIN, Role.FINANCE, Role.OPS)
@Controller('admin/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('balance')
  async balance(@Query('account') account: string, @Query('scopeId') scopeId?: string) {
    if (!isLedgerAccount(account)) {
      throw new BadRequestException(`Unknown ledger account: ${account}`);
    }

    return this.ledger.balance(account as LedgerAccount, scopeId ?? null);
  }

  @Get('integrity')
  integrity() {
    return this.ledger.checkIntegrity();
  }
}

/**
 * The nightly integrity job (readiness item G5).
 *
 * Runs on a schedule rather than on demand, because the failure it looks for is
 * silent by definition: nothing breaks when the ledger stops balancing, the
 * numbers simply become wrong, and the first symptom is a customer disputing a
 * balance weeks later.
 *
 * Seventh tenant of the job runner from P2.5a.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/ledger-integrity')
export class LedgerIntegrityController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  run() {
    return this.ledger.checkIntegrity();
  }
}
