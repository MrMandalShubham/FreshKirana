import { Injectable, Logger } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  SYSTEM_ACTOR,
  type PaymentEvent,
} from '@freshkirana/contracts';
import { InventoryService } from '../../inventory/contracts';
import { PaymentService } from '../../payment/contracts';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';
import { PaymentRecoveryService } from './payment-recovery.service';

export interface WebhookOutcome {
  handled: boolean;
  reason: string;
  orderId?: string;
  status?: string;
}

/**
 * What a payment outcome means for an order (spec §2.10, §2.6.2).
 *
 * ## Why this lives in `order`
 *
 * The same reason the WhatsApp flow does (P2.5): `payment` knows about money
 * and must not know what an order status means, so the half that decides
 * belongs on this side of the dependency. The arrow runs one way,
 * `order → payment`.
 *
 * ## Fulfilment and payment are separate axes (§2.6.2)
 *
 * A captured payment moves the *order* to AWAITING_VENDOR and the *payment* to
 * CAPTURED. They are two statuses because they diverge constantly — a delivered
 * order can be refunded, and a COD order is fulfilled long before it is paid.
 */
@Injectable()
export class PaymentFlowService {
  private readonly logger = new Logger(PaymentFlowService.name);

  constructor(
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly inventory: InventoryService,
    private readonly recovery: PaymentRecoveryService,
  ) {}

  /**
   * Handles a webhook from the gateway.
   *
   * Verification happens before parsing, and parsing before anything is acted
   * on. A body that fails the signature check is never read — the order matters
   * as much as the check itself.
   */
  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
  ): Promise<WebhookOutcome> {
    if (!this.payments.verifySignature(rawBody, signature)) {
      // Deliberately says nothing about *why*. A caller who can tell a bad
      // signature from a malformed body can probe for one.
      return { handled: false, reason: 'INVALID_SIGNATURE' };
    }

    const event = this.payments.parseWebhook(rawBody);
    if (!event) return { handled: false, reason: 'UNRECOGNISED_EVENT' };

    return this.applyEvent(event, 'WEBHOOK');
  }

  /**
   * The recovery loop (§2.10.3, §2.11.3).
   *
   * Webhooks are lost. A deploy restarts an instance mid-request, a network
   * blips, a gateway has an incident — and the result is an order sitting in
   * PENDING_PAYMENT while the customer's money is gone. That is the worst
   * failure this system has, and it is silent, so something has to go looking.
   *
   * One payment at a time, so a single bad row cannot strand the rest.
   */
  async reconcilePending(olderThanMinutes = 2) {
    const pending = await this.payments.pendingOlderThan(olderThanMinutes);

    let recovered = 0;
    let failed = 0;

    for (const row of pending) {
      if (!row.providerOrderId) continue;

      try {
        const snapshot = await this.payments.fetchFromProvider(row.providerOrderId);
        if (!snapshot || snapshot.status === PaymentStatus.PENDING) continue;

        const applied = await this.applyEvent(
          {
            // Distinct from any webhook id, so recovering a payment the webhook
            // later delivers is not mistaken for the same event twice — and so
            // §2.11.3 can count how often this path was needed.
            providerEventId: `reconcile:${row.providerOrderId}:${snapshot.status}`,
            providerPaymentId: snapshot.providerPaymentId ?? '',
            providerOrderId: row.providerOrderId,
            status: snapshot.status,
            amountPaise: snapshot.amountPaise,
            method: snapshot.method,
            failureReason: snapshot.failureReason,
            raw: { source: 'reconciliation', snapshot },
          },
          'RECONCILIATION',
        );

        if (applied.handled) {
          recovered += 1;
          this.logger.warn(
            `Recovered payment ${row.providerOrderId} by reconciliation — the webhook did not arrive`,
          );
        }
      } catch (error) {
        failed += 1;
        this.logger.error(`Could not reconcile payment ${row.id}: ${String(error)}`);
      }
    }

    // The other half of §2.10.3: payments nobody completed. Recovering a lost
    // webhook and cancelling an abandoned checkout are the same sweep, because
    // both ask "what actually happened to the money?" — and an order stuck in
    // PENDING_PAYMENT holds stock and a delivery slot either way.
    const expired = await this.recovery.cancelExpired();

    return {
      considered: pending.length,
      recovered,
      failed: failed + expired.failed,
      cancelled: expired.cancelled,
    };
  }

  // -------------------------------------------------------------------------

  private async applyEvent(
    event: PaymentEvent,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<WebhookOutcome> {
    const applied = await this.payments.apply(event, source);
    if (!applied) return { handled: false, reason: 'NO_MATCHING_PAYMENT' };
    if (!applied.changed) return { handled: false, reason: applied.reason };

    const order = await this.orders.findById(applied.orderId);
    if (!order) return { handled: false, reason: 'NO_MATCHING_ORDER' };

    if (applied.status === PaymentStatus.CAPTURED) {
      return this.onCaptured(applied.orderId, order.status as OrderStatus);
    }

    if (applied.status === PaymentStatus.FAILED) {
      return this.onFailed(applied.orderId, order.status as OrderStatus);
    }

    // Authorised but not captured — a card hold. Nothing moves until the money
    // is actually taken.
    return {
      handled: true,
      reason: `PAYMENT_${applied.status}`,
      orderId: applied.orderId,
    };
  }

  /**
   * The money arrived.
   *
   * The stock has been held since checkout; confirming it here is what stops
   * the §2.5 sweeper releasing it out from under a paid order.
   */
  private async onCaptured(
    orderId: string,
    current: OrderStatus,
  ): Promise<WebhookOutcome> {
    await this.inventory.confirmForOrder(orderId);

    if (current !== OrderStatus.PENDING_PAYMENT) {
      // Already moved on — a reconciliation pass racing the webhook, or ops
      // pushing it through by hand. The money is recorded either way.
      return { handled: true, reason: 'ALREADY_MOVED', orderId, status: current };
    }

    const { order } = await this.state.transition(
      orderId,
      OrderStatus.AWAITING_VENDOR,
      { accountId: null, role: SYSTEM_ACTOR },
      { reason: 'Payment captured' },
    );

    return { handled: true, reason: 'ORDER_CONFIRMED', orderId, status: order.status };
  }

  /**
   * The payment failed — which is not the same as the order failing.
   *
   * §2.10.3 step 4: the order stays in PENDING_PAYMENT until its window closes,
   * holding its stock and its slot, while the shopper is offered another go.
   * A declined UPI payment is not somebody changing their mind; it is somebody
   * who tried to pay and was told no by a bank, and cancelling on them turns a
   * recoverable moment into a lost order.
   *
   * The sweeper cancels it if nothing comes of the offer.
   */
  private async onFailed(orderId: string, current: OrderStatus): Promise<WebhookOutcome> {
    if (current !== OrderStatus.PENDING_PAYMENT) {
      return { handled: true, reason: 'ALREADY_MOVED', orderId, status: current };
    }

    // Reaches them where they actually are: the common failure is a shopper who
    // switched to their bank's app, hit a problem, and never came back to the
    // browser tab.
    await this.recovery.sendRecoveryLink(orderId).catch((error: unknown) => {
      this.logger.warn(`Could not send the recovery link: ${String(error)}`);
      return false;
    });

    return {
      handled: true,
      reason: 'PAYMENT_FAILED_RECOVERY_OFFERED',
      orderId,
      status: current,
    };
  }
}
