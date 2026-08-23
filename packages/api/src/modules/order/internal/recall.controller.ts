import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { type Principal, RecallStatus, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles } from '../../identity/contracts';
import { RaiseRecallDto } from './recall.dto';
import { RecallService } from './recall.service';

/**
 * Withdrawing an unsafe lot (spec §1.7.3).
 *
 * Admin and ops only, and never a vendor: a shop discovering a problem should
 * be able to raise it, but a shop deciding unilaterally that a recall is over —
 * or quietly not raising one — is the failure mode this exists to prevent. The
 * vendor-facing path is a support conversation until P7.2 gives ops a console.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/recalls')
export class RecallController {
  constructor(private readonly recalls: RecallService) {}

  @Get()
  list(@Query('status') status?: RecallStatus) {
    return this.recalls.list(status);
  }

  /**
   * Raises one. Sale is blocked before this returns.
   *
   * Notification is a separate call on purpose: blocking the lot must not wait
   * on a messaging provider, and somebody staring at a slow request is somebody
   * who will press the button again.
   */
  @Post()
  raise(@CurrentUser() principal: Principal, @Body() dto: RaiseRecallDto) {
    return this.recalls.raise({
      masterProductId: dto.masterProductId,
      batchNo: dto.batchNo,
      reason: dto.reason,
      raisedBy: principal.accountId,
      ...(dto.note === undefined ? {} : { note: dto.note }),
    });
  }

  /** The regulator-ready record (§1.7.3). */
  @Get(':recallId')
  report(@Param('recallId') recallId: string) {
    return this.recalls.report(recallId);
  }

  @Post(':recallId/notify')
  notify(@Param('recallId') recallId: string) {
    return this.recalls.notify(recallId);
  }

  @Post(':recallId/close')
  close(@Param('recallId') recallId: string) {
    return this.recalls.close(recallId);
  }
}
