import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnalyticsEvent,
  CodConfirmationMethod,
  CodConfirmationStatus,
  CodRiskBand,
  CustomerReply,
  NotificationChannel,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  type RiskAssessment,
  type RiskInput,
  SYSTEM_ACTOR,
  confirmationFor,
} from '@freshkirana/contracts';
import { AnalyticsService } from '../../analytics/contracts';
import {
  CodConfigService,
  CodConfirmationService,
  RuleRiskScorer,
} from '../../cod/contracts';
import { InventoryService } from '../../inventory/contracts';
import { NotificationService } from '../../notification/contracts';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';
import { BranchOrderFlowService } from './branch-order-flow.service';

export interface CodAssessment {
  band: CodRiskBand;
  score: number;
  reasons: string[];
  method: CodConfirmationMethod;
  /** False when COD must not be offered at all (§2.10.4, BLOCKED). */
  allowed: boolean;
}

/**
 * Cash on delivery: how much certainty to buy before a shop starts packing
 * (spec §2.10.4).
 *
 * ## Why an order can wait
 *
 * §2.10.4 requires confirmation *before branch acceptance*, and §2.6.1 has no
 * state for "confirming" — so a COD order awaiting confirmation waits in
 * `PENDING_PAYMENT`, which is the state that already means exactly this: not
 * yet released to the store, because the money question is unsettled. For
 * prepaid that question is settled by capture; for COD it is settled by the
 * customer saying yes.
 *
 * That also makes the timeout free: `PENDING_PAYMENT → CANCELLED` on expiry is
 * already in the transition table, with the effects that release the stock and
 * the slot. Inventing an eighteenth status would have bought a better-sounding
 * name and a second cancellation path to keep correct.
 *
 * This service holds the orchestration; `cod` owns the scoring, the codes and
 * the audit trail, and knows nothing about orders beyond an id.
 */
@Injectable()
export class CodFlowService {
  private readonly logger = new Logger(CodFlowService.name);

  constructor(
    private readonly scorer: RuleRiskScorer,
    private readonly config: CodConfigService,
    private readonly confirmations: CodConfirmationService,
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
    private readonly vendorFlow: BranchOrderFlowService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Scores a basket before it becomes an order.
   *
   * Used by checkout's preview so BLOCKED is shown *at* checkout rather than
   * discovered on submit — §2.10.4 says "shown transparently", and a payment
   * method that disappears at the last step reads as a bug.
   *
   * Deterministic, so this and the scoring at placement always agree. That is
   * the practical argument for rules over a model here, quite apart from §3.8.
   */
  async assess(input: {
    accountId: string;
    orderTotalPaise: number;
    addressPincode: string;
    paymentMethod: PaymentMethod;
  }): Promise<CodAssessment> {
    if (input.paymentMethod !== PaymentMethod.COD) {
      return {
        band: CodRiskBand.LOW,
        score: 0,
        reasons: ['Prepaid — nothing to collect'],
        method: CodConfirmationMethod.NONE,
        allowed: true,
      };
    }

    const history = await this.orders.historyCountsFor(input.accountId);

    const riskInput: RiskInput = {
      accountId: input.accountId,
      orderTotalPaise: input.orderTotalPaise,
      paymentMethod: PaymentMethod.COD,
      completedOrderCount: history.completed,
      rtoCount: history.returned,
      addressPincode: input.addressPincode,
    };

    const assessment = await this.scorer.score(riskInput);
    const band = assessment.band as CodRiskBand;

    return {
      band,
      score: assessment.score,
      reasons: assessment.reasons,
      method: confirmationFor(band),
      allowed: band !== CodRiskBand.BLOCKED,
    };
  }

  /**
   * Writes the decision down and starts the ceremony, if one is needed.
   *
   * Called *after* the order is written but with an assessment made *before*
   * it — because the initial status depends on the answer, and an order created
   * as AWAITING_VENDOR cannot be walked back to PENDING_PAYMENT: §2.6.1 has no
   * such edge, and adding one would make "the store already saw it" a
   * reversible fact, which it is not.
   *
   * Returns whether the store may be told. The caller announces, because the
   * same decision governs prepaid orders that announce at capture instead.
   */
  async onPlaced(
    orderId: string,
    assessment: CodAssessment,
  ): Promise<{ releasedToVendor: boolean }> {
    const order = await this.orders.findById(orderId);
    if (!order || order.paymentMethod !== PaymentMethod.COD) {
      return { releasedToVendor: true };
    }

    const thresholds = await this.config.current();
    const history = await this.orders.historyCountsFor(order.accountId);

    await this.confirmations.recordDecision({
      orderId,
      accountId: order.accountId,
      assessment: {
        band: assessment.band,
        score: assessment.score,
        reasons: assessment.reasons,
      } satisfies RiskAssessment,
      thresholds,
      inputs: {
        accountId: order.accountId,
        orderTotalPaise: order.grandTotalPaise,
        paymentMethod: PaymentMethod.COD,
        completedOrderCount: history.completed,
        rtoCount: history.returned,
        addressPincode: order.addressPincode,
      },
      confirmationMethod: assessment.method,
    });

    void this.analytics.emit(AnalyticsEvent.COD_RISK_SCORED, {
      accountId: order.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: {
        orderId,
        band: assessment.band,
        score: assessment.score,
        method: assessment.method,
      },
    });

    if (assessment.method === CodConfirmationMethod.NONE) {
      return { releasedToVendor: true };
    }

    await this.openConfirmation(
      order,
      assessment.method,
      thresholds.confirmationWindowMinutes,
    );
    return { releasedToVendor: false };
  }

  /**
   * The customer tapped a button, or typed a code that checked out.
   *
   * Releases the order to the store — the same move `PENDING_PAYMENT →
   * AWAITING_VENDOR` that a captured payment makes, because it answers the same
   * question.
   */
  async confirm(orderId: string, resolvedBy?: string, note?: string) {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('No such order');

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      // Already released, or already cancelled by the sweeper. Either way the
      // question this answers is closed, and answering it twice is a no-op
      // rather than an error — the customer tapped a button in good faith.
      return order;
    }

    const closed = await this.confirmations.resolve(
      orderId,
      resolvedBy ? CodConfirmationStatus.OVERRIDDEN : CodConfirmationStatus.CONFIRMED,
      resolvedBy,
      note,
    );

    if (!closed) {
      throw new ConflictException({
        message: 'This confirmation is no longer open',
        code: 'CONFIRMATION_CLOSED',
      });
    }

    // The holds have been provisional since checkout, waiting on exactly this.
    // Cash has no payment to wait for afterwards, so they settle now.
    await this.inventory.confirmForOrder(orderId);

    const { order: moved } = await this.state.transition(
      orderId,
      OrderStatus.AWAITING_VENDOR,
      { accountId: order.accountId, role: SYSTEM_ACTOR },
      {
        reason: resolvedBy
          ? 'Cash order confirmed by ops'
          : 'Cash order confirmed by customer',
      },
    );

    // Only now, which is the whole point of the part: the store has heard
    // nothing about this order until somebody vouched for it.
    void this.vendorFlow.announceNewOrder(orderId);

    void this.analytics.emit(
      resolvedBy ? AnalyticsEvent.COD_OVERRIDDEN : AnalyticsEvent.COD_CONFIRMED,
      {
        accountId: order.accountId,
        anonId: 'account',
        sessionId: 'unknown',
        properties: { orderId, ...(note ? { note } : {}) },
      },
    );

    return moved;
  }

  /** The customer said no. Cheaper now than as a return three days later. */
  async decline(orderId: string, resolvedBy?: string, note?: string) {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('No such order');
    if (order.status !== OrderStatus.PENDING_PAYMENT) return order;

    await this.confirmations.resolve(
      orderId,
      CodConfirmationStatus.DECLINED,
      resolvedBy,
      note,
    );

    const { order: moved } = await this.state.transition(
      orderId,
      OrderStatus.CANCELLED,
      { accountId: order.accountId, role: SYSTEM_ACTOR },
      { reason: 'Customer declined the cash order' },
    );

    void this.analytics.emit(AnalyticsEvent.COD_DECLINED, {
      accountId: order.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId },
    });

    return moved;
  }

  /**
   * A typed code (§2.10.4, HIGH band).
   *
   * Returns the outcome rather than throwing on a wrong code: "that code is
   * wrong, three tries left" is information the customer needs, and an
   * exception carries it badly.
   */
  async verifyOtp(orderId: string, accountId: string, code: string) {
    // Scoped to the caller's own order first, so a wrong-code response cannot
    // be used to probe whether somebody else's order exists (§3.2).
    const order = await this.orders.findForAccount(accountId, orderId);

    const outcome = await this.confirmations.verifyOtp(order.id, code);
    if (!outcome.ok) return outcome;

    await this.confirm(orderId);
    return { ok: true as const };
  }

  /**
   * Nobody answered (§2.10.4).
   *
   * The order is holding stock and a delivery slot that customers who *would*
   * confirm cannot have. One at a time, so a single bad row cannot strand the
   * rest of the sweep.
   */
  async expireOverdue() {
    const overdue = await this.confirmations.overdue();

    let cancelled = 0;
    let failed = 0;

    for (const ceremony of overdue) {
      try {
        const closed = await this.confirmations.resolve(
          ceremony.orderId,
          CodConfirmationStatus.EXPIRED,
        );
        if (!closed) continue;

        const order = await this.orders.findById(ceremony.orderId);
        if (!order || order.status !== OrderStatus.PENDING_PAYMENT) continue;

        // Cancelling releases the stock and the slot through the state
        // machine's own declared effects, not by hand here.
        await this.state.transition(
          ceremony.orderId,
          OrderStatus.CANCELLED,
          { accountId: null, role: SYSTEM_ACTOR },
          { reason: 'Cash order was not confirmed in time' },
        );

        cancelled += 1;

        void this.analytics.emit(AnalyticsEvent.COD_CONFIRMATION_EXPIRED, {
          accountId: ceremony.accountId,
          anonId: 'account',
          sessionId: 'unknown',
          properties: { orderId: ceremony.orderId },
        });
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Could not expire COD confirmation ${ceremony.id}: ${String(error)}`,
        );
      }
    }

    return { considered: overdue.length, cancelled, failed };
  }

  // -------------------------------------------------------------------------

  private async openConfirmation(
    order: {
      id: string;
      accountId: string;
      orderNumber: string;
      recipientPhone: string;
      branchId: string;
      grandTotalPaise: number;
    },
    method: CodConfirmationMethod,
    windowMinutes: number,
  ): Promise<void> {
    const opened = await this.confirmations.open({
      orderId: order.id,
      accountId: order.accountId,
      method,
      windowMinutes,
    });

    const isOtp = method === CodConfirmationMethod.OTP;

    await this.notifications.send({
      channel: NotificationChannel.WHATSAPP,
      template: isOtp ? NotificationTemplate.COD_OTP : NotificationTemplate.COD_CONFIRM,
      toPhone: order.recipientPhone,
      accountId: order.accountId,
      orderId: order.id,
      branchId: order.branchId,
      // Buttons for the band where a tap is enough. The OTP band deliberately
      // has none: the whole reason for a code is that tapping is too easy.
      ...(isOtp ? {} : { quickReplies: [CustomerReply.CONFIRM, CustomerReply.DECLINE] }),
      payload: {
        orderNumber: order.orderNumber,
        amountPaise: order.grandTotalPaise,
        expiresAt: opened.expiresAt.toISOString(),
        // Sent, never stored in plaintext, and gone from memory after this.
        ...(opened.otp ? { code: opened.otp } : {}),
      },
    });

    void this.analytics.emit(AnalyticsEvent.COD_CONFIRMATION_SENT, {
      accountId: order.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId: order.id, method },
    });
  }
}
