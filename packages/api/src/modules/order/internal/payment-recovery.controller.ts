import { Controller, Get, Param, Post } from '@nestjs/common';
import { AnalyticsEvent, type Principal } from '@freshkirana/contracts';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Public } from '../../identity/contracts';
import { PaymentService } from '../../payment/contracts';
import { PaymentRecoveryService } from './payment-recovery.service';

/**
 * Getting a failed payment back (spec §2.10.3).
 *
 * Scoped to the caller's own order throughout — "retry somebody else's payment"
 * is not expressible here (§3.2).
 */
@Controller('me/orders/:orderId/payment')
export class PaymentRecoveryController {
  constructor(
    private readonly recovery: PaymentRecoveryService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** What this order can still do, so the screen shows buttons that work. */
  @Get('recovery')
  offer(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    return this.recovery.offerFor(orderId, principal.accountId);
  }

  @Post('retry')
  async retry(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    const intent = await this.recovery.retry(orderId, principal.accountId);

    // Rule R1. Recovery only pays for itself if somebody can see whether it
    // works — without this the only visible number is orders lost.
    void this.analytics.emit(AnalyticsEvent.PAYMENT_RETRIED, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId, amountPaise: intent.amountPaise },
    });

    return intent;
  }

  /** Sends the link again, for a shopper who lost the message. */
  @Post('send-link')
  async sendLink(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    const sent = await this.recovery.sendRecoveryLink(orderId);

    void this.analytics.emit(AnalyticsEvent.PAYMENT_LINK_SENT, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId, sent },
    });

    return { sent };
  }

  @Post('convert-to-cod')
  async convertToCod(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
  ) {
    const order = await this.recovery.convertToCod(orderId, principal.accountId);

    // The §1.3.2 contribution model turns on how many of these there are: a
    // recovered order is revenue, and a COD one carries collection risk.
    void this.analytics.emit(AnalyticsEvent.PAYMENT_CONVERTED_TO_COD, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId, grandTotalPaise: order.grandTotalPaise },
    });

    return order;
  }
}

/**
 * The "finish paying" link (§2.10.3 step 2).
 *
 * `@Public` because it arrives from a WhatsApp message, and the shopper may not
 * be signed in on the device that opens it — demanding a login here would lose
 * exactly the order this exists to save.
 *
 * The token is the credential. It is long, random, single-attempt, expires with
 * the payment window, and is revoked the moment a new attempt supersedes it.
 * The response deliberately carries nothing about the customer: an order
 * number, an amount, and the handle needed to pay.
 */
@Controller('pay')
export class PaymentLinkController {
  constructor(private readonly payments: PaymentService) {}

  @Public()
  @Get(':token')
  async resolve(@Param('token') token: string) {
    const found = await this.payments.resolveRecoveryToken(token);

    // The same answer for "never existed" and "no longer valid": a link that
    // says which one it is lets somebody probe for live tokens.
    if (!found) return { usable: false, reason: 'LINK_NOT_VALID' };

    if (!found.usable) {
      return { usable: false, reason: 'LINK_EXPIRED' };
    }

    return {
      usable: true,
      amountPaise: found.payment.amountPaise,
      providerOrderId: found.payment.providerOrderId,
      keyId: process.env['RAZORPAY_KEY_ID'] ?? null,
      expiresAt: found.payment.expiresAt?.toISOString() ?? null,
    };
  }
}
