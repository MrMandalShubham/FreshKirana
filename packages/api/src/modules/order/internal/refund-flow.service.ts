import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnalyticsEvent,
  NotificationChannel,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  REFUNDABLE_ON_CANCEL,
  RefundReason,
  cancellationFeePaise,
  etaFor,
  isFullyRefunded,
  routeFor,
} from '@freshkirana/contracts';
import { AnalyticsService } from '../../analytics/contracts';
import { NotificationService } from '../../notification/contracts';
import { RefundService, type RefundView } from '../../payment/contracts';
import { OrderService } from './order.service';

/**
 * What a cancellation owes the customer (spec §1.8.1, §1.8.2).
 *
 * ## Why this lives in `order`
 *
 * The same reason the payment and WhatsApp flows do: `payment` knows about
 * money and must not know what an order status means. Whether a cancelled
 * order owes anything is a question about the order — a cash order cancelled
 * before delivery owes nothing at all, because nothing was ever taken.
 *
 * ## Automatic, not requested
 *
 * §1.8.1's confirmation text is "cancel before branch acceptance — refund
 * initiated automatically". A refund a customer has to ask for is a refund a
 * fraction of customers will not ask for, and the difference between those two
 * designs is money quietly kept from people who are owed it.
 */
@Injectable()
export class RefundFlowService {
  private readonly logger = new Logger(RefundFlowService.name);

  constructor(
    private readonly orders: OrderService,
    private readonly refunds: RefundService,
    private readonly notifications: NotificationService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * The fee for cancelling now, in paise.
   *
   * Configuration rather than a constant: §1.8.1 says a fee is allowed and
   * defaults to none in V1, and the moment a pilot city wants one the answer
   * should not be a code change.
   */
  private get configuredFeePaise(): number {
    const raw = Number(process.env['CANCELLATION_FEE_PAISE'] ?? 0);
    return Number.isInteger(raw) && raw >= 0 ? raw : 0;
  }

  /**
   * Called after an order reaches CANCELLED, whoever cancelled it.
   *
   * Deliberately never throws. A refund that fails to start must not undo a
   * cancellation that already happened — the order is cancelled either way, and
   * an obligation nobody recorded is worse than one that needs chasing.
   */
  async onCancelled(
    orderId: string,
    reason: RefundReason,
    cancelledFrom: OrderStatus,
  ): Promise<RefundView | null> {
    try {
      const order = await this.orders.findById(orderId);
      if (!order) return null;

      // Cash owes nothing until the rider has been paid. Cancelling before that
      // is simply an order that never happened, and issuing a "refund" of money
      // never taken would put a lie in the ledger.
      const paidPaise = await this.amountActuallyTaken(orderId, order);
      if (paidPaise <= 0) return null;

      if (!REFUNDABLE_ON_CANCEL.includes(cancelledFrom)) return null;

      const fee = cancellationFeePaise(cancelledFrom, this.configuredFeePaise);
      const amount = await this.refunds.remainingPaise(orderId, paidPaise, fee);
      if (amount <= 0) return null;

      const view = await this.refunds.issue({
        orderId,
        accountId: order.accountId,
        amountPaise: amount,
        reason,
        paymentMethod: order.paymentMethod as PaymentMethod,
        // Derived, not generated (rule R4): "cancel order X" is one intent
        // however many times it is submitted.
        idempotencyKey: `cancel:${orderId}`,
      });

      await this.syncPaymentStatus(orderId, paidPaise);
      await this.tell(order, view);
      return view;
    } catch (error) {
      this.logger.error(
        `Could not start the refund for cancelled order ${orderId}: ${String(error)}`,
      );
      return null;
    }
  }

  /**
   * A partial refund — a missing item, an underweight line (§1.8.2, §1.8.3).
   *
   * The amount is passed in rather than derived from the line, because the
   * caller knows things this does not: a substituted item refunds the price
   * *difference*, and an underweight line refunds by weight.
   */
  async issuePartial(input: {
    orderId: string;
    amountPaise: number;
    reason: RefundReason;
    orderLineId?: string;
    issuedBy?: string;
    note?: string;
    idempotencyKey: string;
  }): Promise<RefundView> {
    const order = await this.orders.findById(input.orderId);
    if (!order) throw new NotFoundException('No such order');

    const paidPaise = await this.amountActuallyTaken(input.orderId, order);

    if (paidPaise <= 0) {
      throw new ConflictException({
        message: 'Nothing has been collected for this order yet',
        code: 'NOTHING_COLLECTED',
      });
    }

    // Never more than was taken, however the caller arrived at its number. The
    // amount comes from a picker's scale or an operator's judgement, and a
    // refund larger than the payment is a transfer.
    const remaining = await this.refunds.remainingPaise(input.orderId, paidPaise);
    if (input.amountPaise > remaining) {
      throw new ConflictException({
        message: `Only ${remaining} paise is left to refund on this order`,
        code: 'REFUND_EXCEEDS_REMAINING',
        remainingPaise: remaining,
      });
    }

    const view = await this.refunds.issue({
      orderId: input.orderId,
      accountId: order.accountId,
      amountPaise: input.amountPaise,
      reason: input.reason,
      paymentMethod: order.paymentMethod as PaymentMethod,
      idempotencyKey: input.idempotencyKey,
      ...(input.orderLineId ? { orderLineId: input.orderLineId } : {}),
      ...(input.issuedBy ? { issuedBy: input.issuedBy } : {}),
      ...(input.note ? { note: input.note } : {}),
    });

    await this.syncPaymentStatus(input.orderId, paidPaise);
    await this.tell(order, view);
    return view;
  }

  /** Every refund on this order, for the customer's own screen. */
  async forCustomer(orderId: string, accountId: string): Promise<RefundView[]> {
    // Scoped first: "read somebody else's refunds" must not be expressible.
    await this.orders.findForAccount(accountId, orderId);
    return this.refunds.forOrder(orderId);
  }

  /**
   * What cancelling right now would cost and return.
   *
   * §1.8.1 allows cancelling from PACKED "with a warning", and this is the
   * warning: a shopper is entitled to know the fee before they tap, not after.
   */
  async previewCancellation(orderId: string, accountId: string) {
    const order = await this.orders.findForAccount(accountId, orderId);
    const status = order.status as OrderStatus;

    const paidPaise = await this.amountActuallyTaken(orderId, order);
    const feePaise = cancellationFeePaise(status, this.configuredFeePaise);
    const refundPaise = await this.refunds.remainingPaise(orderId, paidPaise, feePaise);
    const route = routeFor(order.paymentMethod as PaymentMethod);
    const eta = etaFor(route);

    return {
      feePaise,
      refundPaise,
      route,
      expectedByMinDays: eta.minDays,
      expectedByMaxDays: eta.maxDays,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Moves the order's payment axis to match what has gone back (§2.6.2).
   *
   * Computed from the refund rows rather than incremented, because a counter
   * that drifts cannot be reconciled against anything — the same argument §2.5
   * makes for the reservation ledger.
   */
  private async syncPaymentStatus(orderId: string, paidPaise: number): Promise<void> {
    const refunded = await this.refunds.totalRefundedPaise(orderId);
    if (refunded <= 0) return;

    await this.orders.setPaymentStatus(
      orderId,
      isFullyRefunded(paidPaise, refunded)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED,
    );
  }

  /**
   * How much of this order's money we are actually holding.
   *
   * Not the order total: a cash order is owed nothing until the rider has been
   * paid, and a prepaid order whose payment failed is owed nothing either. The
   * payment's own status is the only honest source.
   */
  private async amountActuallyTaken(
    orderId: string,
    order: { paymentMethod: string; paymentStatus: string; grandTotalPaise: number },
  ): Promise<number> {
    if (order.paymentMethod === PaymentMethod.COD) {
      // Cash becomes ours only once collected (§2.6.2).
      return order.paymentStatus === PaymentStatus.COD_COLLECTED ||
        order.paymentStatus === PaymentStatus.CAPTURED
        ? order.grandTotalPaise
        : 0;
    }

    const settled =
      order.paymentStatus === PaymentStatus.CAPTURED ||
      order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
      order.paymentStatus === PaymentStatus.REFUNDED;

    void orderId;
    return settled ? order.grandTotalPaise : 0;
  }

  /**
   * Tells the customer, with a range rather than a date.
   *
   * The single most common support question about a refund is "when?", and the
   * only honest answer is a window — the gateway controls the timing and takes
   * the long end often enough that a precise date would be a promise broken in
   * public.
   */
  private async tell(
    order: {
      id: string;
      accountId: string;
      orderNumber: string;
      recipientPhone: string;
      branchId: string;
    },
    view: RefundView,
  ): Promise<void> {
    await this.notifications
      .send({
        channel: NotificationChannel.WHATSAPP,
        template: NotificationTemplate.REFUND_INITIATED,
        toPhone: order.recipientPhone,
        accountId: order.accountId,
        orderId: order.id,
        branchId: order.branchId,
        payload: {
          orderNumber: order.orderNumber,
          amountPaise: view.amountPaise,
          route: view.route,
          expectedByMinDays: view.expectedByMinDays,
          expectedByMaxDays: view.expectedByMaxDays,
        },
      })
      .catch((error: unknown) => {
        // A messaging outage must not undo a refund we have already started.
        this.logger.warn(`Could not tell the customer about a refund: ${String(error)}`);
      });

    void this.analytics.emit(AnalyticsEvent.REFUND_INITIATED, {
      accountId: order.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: {
        orderId: order.id,
        amountPaise: view.amountPaise,
        reason: view.reason,
        route: view.route,
      },
    });
  }
}
