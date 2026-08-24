import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import {
  AnalyticsEvent,
  PaymentMethod,
  type Principal,
  SubstitutionPreference,
} from '@freshkirana/contracts';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser } from '../../identity/contracts';
import { CheckoutService } from './checkout.service';

export class PreviewQueryDto {
  @IsOptional() @IsUUID() addressId?: string;
  @IsOptional() @IsUUID() slotInstanceId?: string;
}

export class PlaceOrderDto {
  @IsUUID() addressId!: string;
  @IsUUID() slotInstanceId!: string;

  @IsOptional()
  @IsIn(Object.values(SubstitutionPreference))
  substitutionPreference?: string;

  @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: string;
}

/**
 * Checkout: address → slot → substitution preference → COD → review → place
 * (spec §1.5.1, §2.2).
 *
 * Signed in throughout. An order needs somebody to deliver to and somebody to
 * hold responsible for the cash, so unlike the cart this is not public.
 */
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** The review screen. Also the answer to "why is the button disabled?". */
  @Get('preview')
  async preview(
    @CurrentUser() principal: Principal,
    @Query() query: PreviewQueryDto,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const preview = await this.checkout.preview(principal.accountId, query);

    void this.analytics.emit(AnalyticsEvent.CHECKOUT_STARTED, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: sessionId ?? 'unknown',
      properties: {
        lineCount: preview.cart.lines.length,
        grandTotalPaise: preview.totals.grandTotalPaise,
        blockerCount: preview.blockers.length,
      },
    });

    return preview;
  }

  @Post('place')
  async place(
    @CurrentUser() principal: Principal,
    @Body() dto: PlaceOrderDto,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const order = await this.checkout.place(principal.accountId, dto);

    // Rule R1. `paymentMethod` and `grandTotalPaise` are what make the §1.3.2
    // contribution model measurable against real orders rather than the plan.
    void this.analytics.emit(AnalyticsEvent.ORDER_PLACED, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: sessionId ?? 'unknown',
      properties: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        branchId: order.branchId,
        paymentMethod: order.paymentMethod,
        grandTotalPaise: order.grandTotalPaise,
        lineCount: order.lines.length,
      },
    });

    return order;
  }
}
