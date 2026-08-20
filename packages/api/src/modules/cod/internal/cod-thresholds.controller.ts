import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { AnalyticsEvent, type Principal, Role } from '@freshkirana/contracts';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Roles } from '../../identity/contracts';
import { CodConfigService } from './cod-config.service';
import { CodConfirmationService } from './cod-confirmation.service';
import { AccountDecisionsQueryDto, UpdateThresholdsDto } from './cod.dto';

/**
 * The knobs, and the log of what they did (spec §2.10.4).
 *
 * Ops rather than admin-only: the people who watch RTO on a bad evening are the
 * people who need to move a threshold, and routing that through an engineer is
 * how "ops-configurable" becomes "configurable by deploy".
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/cod')
export class CodThresholdsController {
  constructor(
    private readonly config: CodConfigService,
    private readonly confirmations: CodConfirmationService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('thresholds')
  thresholds() {
    return this.config.current();
  }

  /**
   * Changes them, with no deploy (§2.10.4).
   *
   * A PUT that takes a partial patch: an operator tightening one number should
   * not have to restate the other seven, and a form that resubmits stale values
   * for the untouched fields is how one change silently reverts another.
   */
  @Put('thresholds')
  async update(@CurrentUser() principal: Principal, @Body() dto: UpdateThresholdsDto) {
    const before = await this.config.current();
    const after = await this.config.update(dto, principal.accountId);

    // Rule R1. This is the event that dates every other COD number: a band
    // distribution that shifts is meaningless without knowing when the rules
    // under it moved.
    void this.analytics.emit(AnalyticsEvent.COD_THRESHOLDS_CHANGED, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { before, after },
    });

    return after;
  }

  /** Why one order was scored the way it was. */
  @Get('decisions/order/:orderId')
  decisionForOrder(@Param('orderId') orderId: string) {
    return this.confirmations.decisionForOrder(orderId);
  }

  /** Every decision about one customer — what support reads on a complaint. */
  @Get('decisions/account/:accountId')
  decisionsForAccount(
    @Param('accountId') accountId: string,
    @Query() query: AccountDecisionsQueryDto,
  ) {
    return this.confirmations.decisionsFor(accountId, query.limit);
  }
}
