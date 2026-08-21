import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  PAYMENT_WINDOW_MINUTES,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentProvider,
  PaymentStatus,
  isSettled,
} from '@freshkirana/contracts';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
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
    attempt = 1,
  ): Promise<PaymentIntent> {
    // Keyed by *attempt*, not by order. A key of `order:{id}` would make the
    // first try the only try — the same mechanism that stops a double charge
    // would refuse the retry §2.10.3 depends on.
    const idempotencyKey = `order:${input.orderId}:attempt:${attempt}`;

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
        attempt,
        recoveryToken: newRecoveryToken(),
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
          sql`${payment.createdAt} < now() - make_interval(mins => ${minutes}::int)`,
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

  /**
   * Offers another go after a failure (§2.10.3).
   *
   * Refused while an attempt is still live: two open intents for one order mean
   * a customer can pay twice, and no amount of reconciliation afterwards makes
   * that a good experience. So a retry is only allowed once the previous
   * attempt has failed or its window has passed.
   */
  async retry(input: StartPaymentInput): Promise<PaymentIntent> {
    const latest = await this.latestAttempt(input.orderId);

    if (latest && !this.canRetryAfter(latest)) {
      throw new ConflictException({
        message: 'That payment is still open. Finish it, or wait for it to expire.',
        code: 'PAYMENT_STILL_OPEN',
        paymentId: latest.id,
      });
    }

    // A dead attempt's link must stop working the moment a new one exists,
    // or a shopper with two WhatsApp messages can open the wrong one.
    if (latest) await this.revokeRecoveryToken(latest.id);

    return this.start(input, this.db, (latest?.attempt ?? 0) + 1);
  }

  /** The most recent attempt for an order, whatever became of it. */
  async latestAttempt(orderId: string) {
    const rows = await this.db
      .select()
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .orderBy(desc(payment.attempt))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Whether a fresh attempt is allowed.
   *
   * Captured is final. Anything still pending inside its window is live, and a
   * second intent alongside it is how somebody pays twice.
   */
  canRetryAfter(latest: { status: string; expiresAt: Date | null }): boolean {
    if (latest.status === PaymentStatus.CAPTURED) return false;
    if (latest.status === PaymentStatus.FAILED) return true;

    return latest.expiresAt !== null && latest.expiresAt.getTime() <= Date.now();
  }

  /**
   * Resolves a "finish paying" link.
   *
   * The token is a bearer credential — whoever holds it can pay this order — so
   * it answers only while the attempt is still live, and says nothing about the
   * customer beyond what the payment screen needs.
   */
  async resolveRecoveryToken(token: string) {
    const rows = await this.db
      .select()
      .from(payment)
      .where(eq(payment.recoveryToken, token))
      .limit(1);

    const found = rows[0];
    if (!found) return null;

    const expired = found.expiresAt !== null && found.expiresAt.getTime() <= Date.now();

    if (expired || isSettled(found.status as PaymentStatus)) {
      return { payment: found, usable: false as const };
    }

    return { payment: found, usable: true as const };
  }

  async revokeRecoveryToken(paymentId: string): Promise<void> {
    await this.db
      .update(payment)
      .set({ recoveryToken: null, updatedAt: new Date() })
      .where(eq(payment.id, paymentId));
  }

  /**
   * Attempts whose window has closed without the money arriving (§2.10.3).
   *
   * The order they belong to is still sitting in PENDING_PAYMENT holding stock
   * and a delivery slot, and nobody is coming back to it.
   */
  async expiredPending(limit = 200) {
    return this.db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.status, PaymentStatus.PENDING),
          isNotNull(payment.expiresAt),
          sql`${payment.expiresAt} < now()`,
        ),
      )
      .orderBy(asc(payment.expiresAt))
      .limit(limit);
  }

  /** Marks an attempt dead once its window has passed. */
  async markExpired(paymentId: string): Promise<void> {
    await this.db
      .update(payment)
      .set({
        status: PaymentStatus.FAILED,
        failureReason: 'The payment window closed before the money arrived',
        recoveryToken: null,
        expiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(payment.id, paymentId), eq(payment.status, PaymentStatus.PENDING)));
  }

  private async noteOutcome(eventId: string, outcome: string): Promise<void> {
    await this.db
      .update(paymentEvent)
      .set({ outcome })
      .where(eq(paymentEvent.id, eventId));
  }
}

/**
 * A link token.
 *
 * 32 random bytes, base64url. Long enough that guessing is not a strategy —
 * anyone holding it can pay somebody else's order, so its only protections are
 * its length and its expiry.
 */
function newRecoveryToken(): string {
  return randomBytes(32).toString('base64url');
}
