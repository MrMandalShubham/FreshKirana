import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PAYMENT_WINDOW_MINUTES,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentProvider,
  PaymentStatus,
  isSettled,
} from '@freshkirana/contracts';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { payment, paymentEvent } from '../schema';
import { PAYMENT_PROVIDER } from './razorpay.provider';

export interface StartPaymentInput {
  orderId: string;
  accountId: string;
  amountPaise: number;
  method: PaymentMethod;
  orderNumber: string;
  customerPhone: string;
}

/** What a settled event means for the order. The caller applies it. */
export interface AppliedPayment {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  /** False when this event had been seen before, or matched nothing. */
  changed: boolean;
  reason: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Asks the gateway for something the customer can pay.
   *
   * Idempotent on the order: a client that retries after a timeout gets the
   * intent it already had rather than a second payable handle for the same
   * order — which would let one order be paid twice (rule R4).
   */
  async start(
    input: StartPaymentInput,
    tx: Transaction | Database = this.db,
  ): Promise<PaymentIntent> {
    const idempotencyKey = `order:${input.orderId}`;

    const existing = await tx
      .select()
      .from(payment)
      .where(eq(payment.idempotencyKey, idempotencyKey))
      .limit(1);

    const already = existing[0];
    if (already?.providerOrderId) {
      return {
        paymentId: already.id,
        providerOrderId: already.providerOrderId,
        amountPaise: already.amountPaise,
        currency: 'INR',
        method: already.method as PaymentMethod,
        expiresAt: (already.expiresAt ?? new Date()).toISOString(),
      };
    }

    const created = await tx
      .insert(payment)
      .values({
        orderId: input.orderId,
        accountId: input.accountId,
        provider: this.provider.name,
        amountPaise: input.amountPaise,
        method: input.method,
        status: PaymentStatus.PENDING,
        idempotencyKey,
        expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000),
      })
      .returning();

    const row = created[0]!;

    const intent = await this.provider.createIntent({
      paymentId: row.id,
      amountPaise: input.amountPaise,
      method: input.method,
      orderNumber: input.orderNumber,
      customerPhone: input.customerPhone,
      idempotencyKey,
    });

    await tx
      .update(payment)
      .set({ providerOrderId: intent.providerOrderId, updatedAt: new Date() })
      .where(eq(payment.id, row.id));

    return intent;
  }

  /** Rejects an unsigned or wrongly-signed body before anything reads it. */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    return this.provider.verifySignature(rawBody, signature);
  }

  parseWebhook(rawBody: string): PaymentEvent | null {
    return this.provider.parseWebhook(rawBody);
  }

  /**
   * Records a gateway event and moves the payment, once.
   *
   * The unique key on (provider, event id) is what makes redelivery safe. A
   * gateway retrying "captured" must not produce a second capture, and a
   * capture applied twice against the ledger is a customer charged once and
   * credited twice.
   *
   * Returns what changed rather than acting on the order itself: this module
   * knows about money, and what a captured payment means for an order is the
   * order module's business.
   */
  async apply(
    event: PaymentEvent,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<AppliedPayment | null> {
    const matched = await this.findByProviderOrderId(event.providerOrderId);

    const recorded = await this.db
      .insert(paymentEvent)
      .values({
        provider: this.provider.name,
        providerEventId: event.providerEventId,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId,
        paymentId: matched?.id ?? null,
        status: event.status,
        raw: event.raw,
        source,
      })
      .onConflictDoNothing({
        target: [paymentEvent.provider, paymentEvent.providerEventId],
      })
      .returning({ id: paymentEvent.id });

    if (recorded.length === 0) {
      // Seen before. The first delivery already did the work.
      return matched
        ? {
            paymentId: matched.id,
            orderId: matched.orderId,
            status: matched.status as PaymentStatus,
            changed: false,
            reason: 'ALREADY_APPLIED',
          }
        : null;
    }

    if (!matched) {
      // An event for a payment we never made. Recorded and left alone — this is
      // either a misconfigured webhook pointing at the wrong environment or
      // something worth a human looking at, and neither is fixed by guessing.
      this.logger.warn(
        `Payment event ${event.providerEventId} matched no payment (order ${event.providerOrderId})`,
      );
      await this.noteOutcome(recorded[0]!.id, 'NO_MATCHING_PAYMENT');
      return null;
    }

    // Conditional on the payment not already being settled: a late "failed"
    // must never undo a capture, and a gateway that sends events out of order
    // is a gateway, not a hypothetical.
    const moved = await this.db
      .update(payment)
      .set({
        status: event.status,
        providerPaymentId: event.providerPaymentId,
        method: event.method ?? matched.method,
        failureReason: event.failureReason,
        capturedAt: event.status === PaymentStatus.CAPTURED ? new Date() : null,
        expiresAt: isSettled(event.status) ? null : matched.expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payment.id, matched.id),
          sql`${payment.status} not in ('CAPTURED', 'REFUNDED')`,
        ),
      )
      .returning();

    if (moved.length === 0) {
      await this.noteOutcome(recorded[0]!.id, 'ALREADY_SETTLED');
      return {
        paymentId: matched.id,
        orderId: matched.orderId,
        status: matched.status as PaymentStatus,
        changed: false,
        reason: 'ALREADY_SETTLED',
      };
    }

    await this.noteOutcome(recorded[0]!.id, `MOVED_TO_${event.status}`);

    return {
      paymentId: matched.id,
      orderId: matched.orderId,
      status: event.status,
      changed: true,
      reason: `MOVED_TO_${event.status}`,
    };
  }

  /**
   * Payments still waiting, oldest first (§2.11.3).
   *
   * The reconciliation loop's input. Webhooks are lost — networks fail, a
   * deploy restarts an instance mid-request — and an order stuck in
   * PENDING_PAYMENT while the customer's money is gone is the worst failure
   * this system has.
   */
  async pendingOlderThan(minutes: number, limit = 200) {
    return this.db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.status, PaymentStatus.PENDING),
          lt(payment.createdAt, new Date(Date.now() - minutes * 60_000)),
        ),
      )
      .orderBy(asc(payment.createdAt))
      .limit(limit);
  }

  /** Asks the gateway directly what happened to a payment. */
  async fetchFromProvider(providerOrderId: string) {
    return this.provider.fetchPayment(providerOrderId);
  }

  async findByProviderOrderId(providerOrderId: string) {
    const rows = await this.db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.provider, this.provider.name),
          eq(payment.providerOrderId, providerOrderId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async forOrder(orderId: string) {
    return this.db
      .select()
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .orderBy(asc(payment.createdAt));
  }

  /** Every event we received about a payment. The dispute record. */
  async eventsFor(paymentId: string) {
    return this.db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.paymentId, paymentId))
      .orderBy(asc(paymentEvent.createdAt));
  }

  private async noteOutcome(eventId: string, outcome: string): Promise<void> {
    await this.db
      .update(paymentEvent)
      .set({ outcome })
      .where(eq(paymentEvent.id, eventId));
  }
}
