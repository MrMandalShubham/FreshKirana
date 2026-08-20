import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles } from '../../identity/contracts';
import {
  CodConfirmationService,
  OverrideConfirmationDto,
  VerifyOtpDto,
} from '../../cod/contracts';
import { CodFlowService } from './cod-flow.service';

/**
 * Confirming a cash order, as the customer (spec §2.10.4).
 *
 * Scoped to the caller's own order throughout — "confirm somebody else's cash
 * order" is not expressible here (§3.2).
 */
@Controller('me/orders/:orderId/cod')
export class CodConfirmationController {
  constructor(
    private readonly flow: CodFlowService,
    private readonly confirmations: CodConfirmationService,
  ) {}

  /**
   * Whether this order is waiting on the customer, and how.
   *
   * Says the method and the deadline and nothing else — in particular not the
   * code, which exists only in the message that carried it.
   */
  @Get()
  async status(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    const found = await this.confirmations.forOrder(orderId);

    if (!found || found.accountId !== principal.accountId) {
      return { pending: false };
    }

    return {
      pending: found.status === 'PENDING',
      method: found.method,
      expiresAt: found.expiresAt.toISOString(),
      attempts: found.attempts,
    };
  }

  @Post('verify')
  verify(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.flow.verifyOtp(orderId, principal.accountId, dto.code);
  }

  /** The customer confirming from the app rather than a WhatsApp button. */
  @Post('confirm')
  async confirm(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    // Ownership first: `confirm` takes an order id, and without this anyone
    // could release anyone's held order to a store.
    const pending = await this.confirmations.forOrder(orderId);
    if (!pending || pending.accountId !== principal.accountId) {
      return { pending: false };
    }

    // Only the quick-reply band. An OTP order that could be confirmed with a
    // plain POST would have no OTP — the code is the whole difference.
    if (pending.method !== 'QUICK_REPLY') {
      return { pending: true, method: pending.method };
    }

    return this.flow.confirm(orderId);
  }

  @Post('decline')
  async decline(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    const pending = await this.confirmations.forOrder(orderId);
    if (!pending || pending.accountId !== principal.accountId) {
      return { pending: false };
    }

    return this.flow.decline(orderId);
  }
}

/**
 * An operator deciding for the customer (§2.10.4).
 *
 * Exists because the rules will sometimes be wrong about a real person, and the
 * alternative to an audited override is an unaudited one — somebody editing a
 * row directly, with no record of who or why. The note is mandatory for that
 * reason.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/orders/:orderId/cod')
export class CodOverrideController {
  constructor(private readonly flow: CodFlowService) {}

  @Post('confirm')
  confirm(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: OverrideConfirmationDto,
  ) {
    return this.flow.confirm(orderId, principal.accountId, dto.note);
  }

  @Post('decline')
  decline(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: OverrideConfirmationDto,
  ) {
    return this.flow.decline(orderId, principal.accountId, dto.note);
  }
}

/**
 * The expiry sweep (§2.10.4).
 *
 * Driven by Cloud Scheduler for the same reason every other sweep is: a timer
 * inside the API dies with the instance, and Cloud Run scales to zero.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/cod-sweep')
export class CodSweepController {
  constructor(private readonly flow: CodFlowService) {}

  @Post()
  run() {
    return this.flow.expireOverdue();
  }
}
