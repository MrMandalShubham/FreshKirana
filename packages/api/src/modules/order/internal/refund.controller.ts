import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { type Principal, RefundReason, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles } from '../../identity/contracts';
import { IssuePartialRefundDto } from './refund.dto';
import { RefundFlowService } from './refund-flow.service';

/**
 * What the customer is owed, and when (spec §1.8.2).
 *
 * Scoped to the caller's own order — "read somebody else's refunds" is not
 * expressible here (§3.2).
 */
@Controller('me/orders/:orderId')
export class CustomerRefundController {
  constructor(private readonly refunds: RefundFlowService) {}

  @Get('refunds')
  list(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    return this.refunds.forCustomer(orderId, principal.accountId);
  }

  /**
   * What cancelling now would cost.
   *
   * §1.8.1 allows cancelling from PACKED "with a warning" — this is the
   * warning. A shopper is entitled to know the fee before they tap, not after.
   */
  @Get('cancellation-preview')
  preview(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    return this.refunds.previewCancellation(orderId, principal.accountId);
  }
}

/**
 * Refunds an operator issues by hand (§1.8.2, §1.8.3).
 *
 * A missing item, an underweight line, a quality complaint. The automatic path
 * covers cancellations; this covers everything a rule cannot decide.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/orders/:orderId/refunds')
export class AdminRefundController {
  constructor(private readonly refunds: RefundFlowService) {}

  @Post()
  issue(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: IssuePartialRefundDto,
  ) {
    return this.refunds.issuePartial({
      orderId,
      amountPaise: dto.amountPaise,
      reason: dto.reason ?? RefundReason.GOODWILL,
      issuedBy: principal.accountId,
      note: dto.note,
      ...(dto.orderLineId ? { orderLineId: dto.orderLineId } : {}),
      /*
       * Keyed by the operator's own reference, not generated.
       *
       * Rule R4, and the reason a double-submitted form cannot pay somebody
       * twice. It has to come from the caller because only they know whether
       * this is the same refund again or a genuinely second one — two
       * underweight lines on one order are two refunds, and a key derived from
       * the order alone would silently collapse them.
       */
      idempotencyKey: `manual:${orderId}:${dto.reference}`,
    });
  }
}
