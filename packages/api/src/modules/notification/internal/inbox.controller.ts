import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Principal } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../../identity/contracts';
import { NotificationService } from './notification.service';

export class InboxQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * The customer's in-app notifications (spec §2.12, §4.2).
 *
 * Scoped to the caller's account rather than taking an id from the path, so
 * "somebody else's notifications" is not expressible in this API (§3.2).
 *
 * WhatsApp reaches a customer who is not looking at the app; this is what they
 * find when they do open it. Both are written to the same table, so what the
 * app shows and what support can see are the same record.
 */
@Controller('me/notifications')
export class InboxController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(@CurrentUser() principal: Principal, @Query() query: InboxQueryDto) {
    const [items, unread] = await Promise.all([
      this.notifications.inboxFor(principal.accountId, query.limit),
      this.notifications.unreadCountFor(principal.accountId),
    ]);

    return { items, unread };
  }

  @Post('read')
  async markAllRead(@CurrentUser() principal: Principal) {
    await this.notifications.markAllRead(principal.accountId);
    return { ok: true };
  }

  @Post(':messageId/read')
  async markRead(
    @CurrentUser() principal: Principal,
    @Param('messageId') messageId: string,
  ) {
    await this.notifications.markRead(principal.accountId, messageId);
    return { ok: true };
  }
}
