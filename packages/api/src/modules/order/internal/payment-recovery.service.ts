import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  CodRiskBand,
  NotificationChannel,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  SYSTEM_ACTOR,
} from '@freshkirana/contracts';
import { RuleRiskScorer } from '../../cod/contracts';
import { InventoryService } from '../../inventory/contracts';
import { NotificationService } from '../../notification/contracts';
import { PaymentService } from '../../payment/contracts';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';

export interface RecoveryOffer {
  /** What the shopper can still do about this order. */
  canRetry: boolean;
  canConvertToCod: boolean;
  /** Why COD is not offered, when it is not. */
  codRefusedReason?: string;
}

/**
 * Getting a failed payment back (spec §2.10.3).
 *
 * UPI failure is common and directly costs revenue — a declined payment is not
 * a customer who changed their mind, it is a customer who tried to pay and was
 * told no by a bank. §2.10.3 gives three ways back, in order of how little they
 * ask of the shopper:
 *
 * 1. Try again, with a different app.
 * 2. A link sent to their phone, so they can finish later.
 * 3. Cash on delivery, if we trust them enough — which turns a lost order into
 *    a completed one at the cost of collection risk.
 *
 * And when none of that happens, the order does not linger: at the end of the
 * payment window it is cancelled and everything it was holding goes back.
 */
@Injectable()
export class PaymentRecoveryService {
  private readonly logger = new Logger(PaymentRecoveryService.name);

  constructor(
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
    private readonly risk: RuleRiskScorer,
  ) {}

  /**
   * What this order can still do.
   *
   * Computed rather than assumed, so the screen shows the buttons that will
   * work. Offering "pay again" on an order whose window closed teaches people
   * the app is broken.
   */
  async offerFor(orderId: string, accountId: string): Promise<RecoveryOffer> {
    const order = await this.orders.findForAccount(accountId, orderId);

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return { canRetry: false, canConvertToCod: false };
    }

    // A cash order in PENDING_PAYMENT is not a failed payment (P3.4). It is
    // waiting for the customer to confirm it under §2.10.4, and there is no
    // gateway attempt behind it — so every offer here would be nonsense: "try
    // paying again" for a payment that never started, and "pay cash on delivery
    // instead" for an order that already is. Worse than nonsense, in fact: the
    // second button used to release the order to the store, walking straight
    // around the confirmation this state exists to enforce.
    if (order.paymentMethod === PaymentMethod.COD) {
      return { canRetry: false, canConvertToCod: false };
    }

    const latest = await this.payments.latestAttempt(orderId);
    const canRetry = latest ? this.payments.canRetryAfter(latest) : true;

    const assessment = await this.assessCod(order);

    return {
      canRetry,
      canConvertToCod: assessment.allowed,
      ...(assessment.allowed ? {} : { codRefusedReason: assessment.reason }),
    };
  }

  /**
   * Another attempt, with whichever app they like (§2.10.3 step 1).
   *
   * The stock and the slot are still held from the first attempt — that is the
   * point of holding them — so this is only a new payment, not a new order.
   */
  async retry(orderId: string, accountId: string) {
    const order = await this.orders.findForAccount(accountId, orderId);

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        message: 'This order is not waiting for payment',
        code: 'NOT_AWAITING_PAYMENT',
        status: order.status,
      });
    }

    if (order.paymentMethod === PaymentMethod.COD) {
      throw new ConflictException({
        message: 'This is a cash order. There is no payment to retry.',
        code: 'NOT_A_PREPAID_ORDER',
      });
    }

    return this.payments.retry({
      orderId,
      accountId,
      amountPaise: order.grandTotalPaise,
      method: PaymentMethod.UPI_INTENT,
      orderNumber: order.orderNumber,
      customerPhone: order.recipientPhone,
    });
  }

  /**
   * Sends the "finish paying" link (§2.10.3 step 2).
   *
   * To their phone rather than only on screen, because the common failure is a
   * shopper who switched to their bank's app, hit a problem, and never came
   * back to the browser tab. A message reaches them where they actually are.
   */
  async sendRecoveryLink(orderId: string): Promise<boolean> {
    const order = await this.orders.findById(orderId);
    if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return false;

    const latest = await this.payments.latestAttempt(orderId);
    if (!latest?.recoveryToken) return false;

    await this.notifications.send({
      channel: NotificationChannel.WHATSAPP,
      template: NotificationTemplate.PAYMENT_LINK,
      toPhone: order.recipientPhone,
      accountId: order.accountId,
      orderId: order.id,
      vendorId: order.vendorId,
      payload: {
        orderNumber: order.orderNumber,
        amountPaise: order.grandTotalPaise,
        // The whole URL, not just the token: a WhatsApp template substitutes
        // one variable into a message, and a shopper cannot assemble a link
        // from a base URL they were never sent.
        payUrl: payUrlFor(latest.recoveryToken),
        recoveryToken: latest.recoveryToken,
        expiresAt: latest.expiresAt?.toISOString() ?? null,
      },
    });

    return true;
  }

  /**
   * Takes cash instead (§2.10.3 step 3).
   *
   * Offered only to customers the §2.10.4 rules trust, because COD moves the
   * risk from "we might not get paid now" to "we might not get paid at all,
   * after buying and delivering the goods". For a customer with a history it is
   * a good trade; for a first order at a high value it is not.
   */
  async convertToCod(orderId: string, accountId: string) {
    const order = await this.orders.findForAccount(accountId, orderId);

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        message: 'This order is not waiting for payment',
        code: 'NOT_AWAITING_PAYMENT',
        status: order.status,
      });
    }

    /*
     * Already cash (P3.4).
     *
     * This path confirms the reservations and moves the order to
     * AWAITING_VENDOR, so calling it on a cash order awaiting §2.10.4
     * confirmation released it to the store without the customer ever
     * confirming — the entire risk gate, walked around by pressing the other
     * button. Such an order is finished through the COD flow, not this one.
     */
    if (order.paymentMethod === PaymentMethod.COD) {
      throw new ConflictException({
        message: 'This order is already cash on delivery.',
        code: 'ALREADY_COD',
      });
    }

    const assessment = await this.assessCod(order);
    if (!assessment.allowed) {
      throw new ConflictException({
        message:
          'Cash on delivery is not available for this order. Please try paying again.',
        code: 'COD_NOT_AVAILABLE',
        reasons: assessment.reasons,
      });
    }

    // The open attempt dies here. Leaving it live would let the shopper pay
    // online for an order the rider is also collecting cash for.
    const latest = await this.payments.latestAttempt(orderId);
    if (latest) {
      await this.payments.markExpired(latest.id);
      await this.payments.revokeRecoveryToken(latest.id);
    }

    await this.orders.convertToCod(orderId);

    // The holds have been provisional since checkout; cash on delivery has no
    // payment to wait for, so they are settled now.
    await this.inventory.confirmForOrder(orderId);

    const { order: moved } = await this.state.transition(
      orderId,
      OrderStatus.AWAITING_VENDOR,
      { accountId, role: SYSTEM_ACTOR },
      { reason: 'Payment failed; customer chose cash on delivery' },
    );

    return moved;
  }

  /**
   * Cancels orders whose payment window closed (§2.10.3 step 4).
   *
   * Everything an unpaid order holds — the stock, the delivery slot — is
   * unavailable to customers who *would* pay. Releasing it is the whole reason
   * the window exists.
   *
   * One order at a time, so a single bad row cannot strand the rest.
   */
  async cancelExpired(now = new Date()) {
    const expired = await this.payments.expiredPending(now);

    let cancelled = 0;
    let failed = 0;

    for (const attempt of expired) {
      try {
        await this.payments.markExpired(attempt.id);

        const order = await this.orders.findById(attempt.orderId);
        if (!order || order.status !== OrderStatus.PENDING_PAYMENT) continue;

        // Cancelling releases the stock and the slot through the state
        // machine's own declared effects, not by hand here.
        await this.state.transition(
          attempt.orderId,
          OrderStatus.CANCELLED,
          { accountId: null, role: SYSTEM_ACTOR },
          { reason: 'Payment was not completed within the payment window' },
        );

        cancelled += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Could not cancel unpaid order for payment ${attempt.id}: ${String(error)}`,
        );
      }
    }

    return { considered: expired.length, cancelled, failed };
  }

  // -------------------------------------------------------------------------

  /**
   * Whether this customer may switch to cash.
   *
   * Uses the §2.17.2 RiskScorer, so the rules live in one place and P3.4's
   * confirmation flow will read the same bands rather than inventing its own.
   */
  private async assessCod(order: {
    accountId: string;
    grandTotalPaise: number;
    addressPincode: string;
  }): Promise<{ allowed: boolean; reason?: string; reasons: string[] }> {
    const history = await this.orders.historyCountsFor(order.accountId);

    const assessment = await this.risk.score({
      accountId: order.accountId,
      orderTotalPaise: order.grandTotalPaise,
      paymentMethod: PaymentMethod.COD,
      completedOrderCount: history.completed,
      rtoCount: history.returned,
      addressPincode: order.addressPincode,
    });

    // HIGH is offered too: §2.10.3 prefers a confirmed COD order to a lost one,
    // and P3.4 adds the confirmation step that makes HIGH safe to accept.
    // BLOCKED is the only refusal.
    const allowed = assessment.band !== CodRiskBand.BLOCKED;

    return {
      allowed,
      ...(allowed ? {} : { reason: assessment.reasons.join('. ') }),
      reasons: assessment.reasons,
    };
  }
}

/**
 * Where the recovery link points.
 *
 * `STOREFRONT_BASE_URL` is deployment configuration — the API does not
 * otherwise know it has a storefront, and hardcoding a host would send staging
 * customers to production. The locale segment is `en` because we have no
 * language preference on the account yet; the page itself is translated, so
 * this is the one thing to revisit when preferences land.
 */
function payUrlFor(token: string): string {
  const base = (process.env['STOREFRONT_BASE_URL'] ?? '').replace(/\/+$/, '');
  return `${base}/en/pay/${token}`;
}
