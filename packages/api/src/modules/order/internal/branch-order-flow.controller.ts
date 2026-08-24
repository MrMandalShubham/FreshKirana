import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public, Roles, BranchScopeGuard } from '../../identity/contracts';
import { NotificationService } from '../../notification/contracts';
import { InboundReplyService } from './inbound-reply.service';
import { BranchOrderFlowService } from './branch-order-flow.service';

export class OutboxQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * The provider's webhook (spec §2.12).
 *
 * `@Public` because the caller is Meta, not a signed-in user. Authenticity is
 * the provider's signature, which the real channel will verify — the mock has
 * nothing to verify, and that gap is exactly why this route stays out of
 * production until B1 lands.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  // The router, not the branch flow: stores and customers both tap buttons on
  // this one webhook, and which vocabulary arrived decides what happens next.
  constructor(private readonly inbound: InboundReplyService) {}

  /**
   * Always 200.
   *
   * A provider that receives an error retries, and retrying a message we simply
   * did not understand achieves nothing except doing it again. The body says
   * what happened; the status says we received it.
   */
  @Public()
  @Post()
  async receive(@Body() body: unknown) {
    return this.inbound.handle(body);
  }
}

/**
 * The SLA sweep (spec §1.9.4).
 *
 * Driven by Cloud Scheduler rather than an in-process timer: a timer inside the
 * API dies with the instance, and Cloud Run scales to zero. The endpoint is
 * idempotent, because a scheduler that fires twice is normal.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/branch-sla')
export class VendorSlaController {
  constructor(private readonly flow: BranchOrderFlowService) {}

  @Post('sweep')
  sweep() {
    return this.flow.sweepAcceptanceSla();
  }
}

/**
 * What the store was sent.
 *
 * With the mock channel this is the only place a message exists, which makes it
 * the test UI the confirmation step needs: place an order, read the message
 * here, tap its button through the webhook. With a real BSP it stays useful as
 * the §2.12 delivery-receipt log.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId/messages')
export class VendorMessagesController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: OutboxQueryDto) {
    return this.notifications.messagesForVendor(branchId, query.limit);
  }
}
