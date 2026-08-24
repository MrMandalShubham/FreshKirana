import { Injectable, Logger } from '@nestjs/common';
import {
  type AcceptanceSla,
  DEFAULT_ACCEPTANCE_SLA,
  NotificationTemplate,
  OrderStatus,
  Role,
  VendorReply,
  isVendorReply,
  hasBreached,
  needsReminder,
} from '@freshkirana/contracts';
import { NotificationService } from '../../notification/contracts';
import { BranchService } from '../../branch/contracts';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';

export interface InboundOutcome {
  handled: boolean;
  /** Why nothing happened, when nothing did. */
  reason?: string;
  orderId?: string;
  status?: string;
}

/**
 * The store's WhatsApp order flow (spec §1.9.3, §1.9.4).
 *
 * ## Why this lives in `order`
 *
 * The obvious home is `notification` — it is a messaging flow. That would close
 * a cycle, and not merely a lint one: the module that talks to a provider would
 * also have to know what an order status means. The dependency only runs one
 * way, `order → notification`, so the half that decides what a tapped button
 * means belongs on this side of it.
 *
 * ## Why WhatsApp at all
 *
 * §0.3 and §1.9.3 are the strategy: a kirana owner will not learn a dashboard,
 * and a branch product that requires one has no branches. Every action here has
 * to work from a phone, tapped with one thumb, without an app.
 */
@Injectable()
export class BranchOrderFlowService {
  private readonly logger = new Logger(BranchOrderFlowService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly vendors: BranchService,
  ) {}

  /** §1.9.4, configurable because peak hours halve the window. */
  get sla(): AcceptanceSla {
    return {
      reminderAfterMinutes: this.fromEnv(
        'VENDOR_ACCEPT_REMINDER_MINUTES',
        DEFAULT_ACCEPTANCE_SLA.reminderAfterMinutes,
      ),
      breachAfterMinutes: this.fromEnv(
        'VENDOR_ACCEPT_SLA_MINUTES',
        DEFAULT_ACCEPTANCE_SLA.breachAfterMinutes,
      ),
    };
  }

  /**
   * Tells the store an order has arrived.
   *
   * Called after the order is committed, never inside its transaction: a
   * provider outage must not undo an order. The store not hearing about it is
   * bad and recoverable — the SLA sweep will chase it. An order that does not
   * exist because WhatsApp was down is neither.
   */
  async announceNewOrder(orderId: string): Promise<void> {
    const order = await this.orders.findById(orderId);
    if (!order) return;

    const vendor = await this.vendors.findById(order.branchId).catch(() => null);
    if (!vendor) return;

    await this.notifications.send({
      toPhone: vendor.phone,
      template: NotificationTemplate.ORDER_NEW,
      quickReplies: [VendorReply.ACCEPT, VendorReply.REJECT],
      branchId: order.branchId,
      orderId: order.id,
      payload: {
        orderNumber: order.orderNumber,
        itemCount: order.lines.length,
        grandTotalPaise: order.grandTotalPaise,
        paymentMethod: order.paymentMethod,
        slotStartsAt: order.slotStartsAt.toISOString(),
        customerArea: order.addressPincode,
        respondWithinMinutes: this.sla.breachAfterMinutes,
      },
    });
  }

  /**
   * Acts on a tapped button.
   *
   * Everything here is deliberately forgiving: a store that types "haan" gets a
   * shrug rather than an error, and a webhook delivered twice does nothing the
   * second time. The one thing it will not do is guess — an unrecognised reply
   * is recorded and left alone.
   */
  async handleInbound(body: unknown): Promise<InboundOutcome> {
    const reply = this.notifications.parseInbound(body);
    if (!reply) return { handled: false, reason: 'UNPARSEABLE' };

    const original = reply.inReplyToProviderMessageId
      ? await this.notifications.findByProviderMessageId(reply.inReplyToProviderMessageId)
      : await this.notifications.lastAwaitingReply(
          reply.fromPhone,
          NotificationTemplate.ORDER_NEW,
        );

    const record = await this.notifications.recordInbound(reply, {
      orderId: original?.orderId ?? null,
      inReplyToMessageId: original?.id ?? null,
    });

    // The provider retried. The first delivery already did the work.
    if (!record.isNew) return { handled: false, reason: 'ALREADY_HANDLED' };

    if (!reply.reply) {
      // Somebody typed instead of tapping. That is a person trying to talk to
      // us, and it belongs in support (P7.3) rather than in a state machine.
      await this.notifications.recordOutcome(record.id, 'FREE_TEXT_IGNORED');
      return { handled: false, reason: 'NOT_A_QUICK_REPLY' };
    }

    if (!original?.orderId) {
      await this.notifications.recordOutcome(record.id, 'NO_MATCHING_ORDER');
      return { handled: false, reason: 'NO_MATCHING_ORDER' };
    }

    // Narrowed here rather than at the parse: both vocabularies arrive on this
    // webhook, and a customer's CONFIRM is routed elsewhere before it gets here.
    const target = isVendorReply(reply.reply) ? this.statusFor(reply.reply) : null;
    if (!target) {
      await this.notifications.recordOutcome(record.id, 'UNSUPPORTED_REPLY');
      return { handled: false, reason: 'UNSUPPORTED_REPLY' };
    }

    try {
      const { order } = await this.state.transition(
        original.orderId,
        target,
        { accountId: null, role: Role.VENDOR_OWNER },
        {
          branchId: original.branchId ?? undefined,
          reason:
            reply.reply === VendorReply.REJECT
              ? 'Store rejected over WhatsApp'
              : undefined,
        },
      );

      await this.notifications.recordOutcome(record.id, `MOVED_TO_${order.status}`);
      return { handled: true, orderId: order.id, status: order.status };
    } catch (error) {
      // A store tapping Accept twice, or tapping it on an order support has
      // already cancelled. Their button was stale — that is not their mistake
      // and it must not read as an error to them.
      const outcome = `REFUSED: ${error instanceof Error ? error.message : String(error)}`;
      await this.notifications.recordOutcome(record.id, outcome.slice(0, 500));
      this.logger.warn(`Inbound reply could not be applied: ${outcome}`);
      return { handled: false, reason: 'TRANSITION_REFUSED', orderId: original.orderId };
    }
  }

  /**
   * Chases stores that have not answered (§1.9.4).
   *
   * Idempotent by construction: the reminder is skipped when the log already
   * shows one, and the breach path moves the order out of AWAITING_VENDOR, so
   * running this twice does nothing twice. It has to be — it is driven by a
   * scheduler, and schedulers fire twice.
   */
  async sweepAcceptanceSla(now = new Date()) {
    const waiting = await this.orders.listByStatus(OrderStatus.AWAITING_VENDOR, 200);
    const sla = this.sla;

    let reminded = 0;
    let breached = 0;
    let failed = 0;

    for (const order of waiting) {
      // One bad order must not stop the batch. This runs on a schedule over
      // every waiting order, and an exception halfway through would leave the
      // rest unswept until somebody noticed — which, for a job whose whole
      // purpose is noticing, is the worst possible failure.
      try {
        if (hasBreached(order.placedAt, sla, now)) {
          await this.breach(order);
          breached += 1;
          continue;
        }

        if (!needsReminder(order.placedAt, sla, now)) continue;

        const alreadyReminded = await this.notifications.wasSentForOrder(
          order.id,
          NotificationTemplate.ORDER_REMINDER,
        );
        if (alreadyReminded) continue;

        const vendor = await this.vendors.findById(order.branchId).catch(() => null);
        if (!vendor) continue;

        await this.notifications.send({
          toPhone: vendor.phone,
          template: NotificationTemplate.ORDER_REMINDER,
          quickReplies: [VendorReply.ACCEPT, VendorReply.REJECT],
          branchId: order.branchId,
          orderId: order.id,
          payload: {
            orderNumber: order.orderNumber,
            minutesLeft: Math.max(
              0,
              Math.round(
                sla.breachAfterMinutes -
                  (now.getTime() - order.placedAt.getTime()) / 60_000,
              ),
            ),
          },
        });

        reminded += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `SLA sweep could not process order ${order.orderNumber}: ${String(error)}`,
        );
      }
    }

    return { considered: waiting.length, reminded, breached, failed };
  }

  /**
   * The store never answered.
   *
   * Two transitions, not one. §1.9.4 wants the order reassigned to the
   * next-best store, and REASSIGNING is where that will happen — routing it
   * through that state now means the audit trail already distinguishes "the
   * store ignored us" from "the customer changed their mind", which is what
   * §6.4 branch scoring reads. Until reassignment exists (deferred), the second
   * step cancels.
   */
  private async breach(order: { id: string; branchId: string; orderNumber: string }) {
    const actor = { accountId: null, role: Role.OPS };

    await this.state.transition(order.id, OrderStatus.REASSIGNING, actor, {
      reason: 'Store did not accept within the SLA',
    });

    const { order: cancelled } = await this.state.transition(
      order.id,
      OrderStatus.CANCELLED,
      actor,
      { reason: 'No other store available to fulfil this order' },
    );

    this.logger.warn(
      `Order ${order.orderNumber} cancelled: store ${order.branchId} missed the acceptance SLA`,
    );

    return cancelled;
  }

  private statusFor(reply: VendorReply): OrderStatus | null {
    switch (reply) {
      case VendorReply.ACCEPT:
        return OrderStatus.ACCEPTED;
      case VendorReply.REJECT:
        return OrderStatus.REASSIGNING;
      case VendorReply.PACKED:
        return OrderStatus.PACKED;
      case VendorReply.HANDED_OVER:
        return OrderStatus.READY_FOR_PICKUP;
      default:
        return null;
    }
  }

  private fromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
