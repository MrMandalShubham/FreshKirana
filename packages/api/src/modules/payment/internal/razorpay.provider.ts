import { Injectable, Logger } from '@nestjs/common';
import {
  type CreateIntentInput,
  PAYMENT_WINDOW_MINUTES,
  type PaymentEvent,
  type PaymentIntent,
  PaymentMethod,
  type PaymentProvider,
  type PaymentSnapshot,
  PaymentStatus,
  type RefundRequest,
  type RefundResult,
} from '@freshkirana/contracts';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * The gateway seam (decision B3: Razorpay).
 *
 * ## What is real here and what is not
 *
 * The **signature scheme is real**: Razorpay signs webhooks with
 * `HMAC-SHA256(rawBody, webhookSecret)` and sends it as `x-razorpay-signature`.
 * This mock implements exactly that, so the verification path that ships is the
 * one under test — swapping in the live provider changes the HTTP calls and
 * nothing about how a body is trusted.
 *
 * The **HTTP calls are not real**: there is no account until B3's paperwork
 * clears, and building against a live sandbox first would have stalled this
 * part behind it. `createIntent` mints a handle locally; `fetchPayment` answers
 * from what the test told it.
 *
 * Anything invented rather than mirrored is marked. Pretending to be the real
 * envelope where it is not would make this look tested when the only thing
 * tested is our own invention.
 */
@Injectable()
export class MockRazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay-mock';

  private readonly logger = new Logger('Razorpay(mock)');

  /**
   * What the mock will say when asked about a payment.
   *
   * Exists so a test can simulate the case §2.10.3 exists for: the customer
   * paid, the webhook never arrived, and reconciliation has to find out.
   */
  private readonly ledger = new Map<string, PaymentSnapshot>();

  /** Keyed by idempotency key, so a retry cannot pay somebody twice (R4). */
  private readonly refunds = new Map<string, RefundResult>();

  private get webhookSecret(): string {
    // Never defaulted silently in production — the boot-time config check
    // (config/env.ts) is where a missing secret must fail, not here.
    return process.env['RAZORPAY_WEBHOOK_SECRET'] ?? 'dev-webhook-secret';
  }

  createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    const providerOrderId = `order_mock${randomUUID().replaceAll('-', '').slice(0, 14)}`;

    this.ledger.set(providerOrderId, {
      providerPaymentId: null,
      status: PaymentStatus.PENDING,
      amountPaise: input.amountPaise,
      method: input.method,
      failureReason: null,
    });

    this.logger.log(
      `intent ${providerOrderId} for ${input.orderNumber}: ${input.amountPaise} paise`,
    );

    return Promise.resolve({
      paymentId: input.paymentId,
      providerOrderId,
      amountPaise: input.amountPaise,
      currency: 'INR',
      method: input.method,
      expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
    });
  }

  /**
   * Razorpay's real scheme: HMAC-SHA256 of the **raw** body.
   *
   * Raw, not re-serialised JSON: `JSON.stringify(JSON.parse(body))` can reorder
   * keys and change whitespace, and the signature is over bytes. A handler that
   * verifies a re-serialised body rejects perfectly good webhooks and, worse,
   * can be made to accept bad ones.
   *
   * Compared in constant time, because a fast rejection tells an attacker how
   * much of their guess was right.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const given = Buffer.from(signature, 'utf8');
    const mine = Buffer.from(expected, 'utf8');

    if (given.length !== mine.length) return false;
    return timingSafeEqual(given, mine);
  }

  /** Signs a body the way the gateway would. Used by tests and the dev tools. */
  signForTesting(rawBody: string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody, 'utf8').digest('hex');
  }

  /**
   * Razorpay's envelope is `{ event, payload: { payment: { entity: {…} } } }`.
   *
   * Mirrored rather than flattened, because this shape is what the live
   * provider sends and the parsing is the part most likely to be wrong.
   */
  parseWebhook(rawBody: string): PaymentEvent | null {
    let body: RazorpayWebhookBody;

    try {
      body = JSON.parse(rawBody) as RazorpayWebhookBody;
    } catch {
      return null;
    }

    const entity = body.payload?.payment?.entity;
    if (!entity?.id || !entity.order_id) return null;

    const status = this.statusFor(body.event, entity.status);
    if (!status) return null;

    const event: PaymentEvent = {
      // Razorpay puts a delivery id in `x-razorpay-event-id`; the body carries
      // `created_at` and the payment id, which together identify the event.
      providerEventId: body.id ?? `${entity.id}:${body.event}`,
      providerPaymentId: entity.id,
      providerOrderId: entity.order_id,
      status,
      amountPaise: entity.amount ?? 0,
      method: this.methodFor(entity.method),
      failureReason: entity.error_description ?? null,
      raw: body as unknown as Record<string, unknown>,
    };

    // Keep the mock's own view consistent, so reconciliation after a webhook
    // agrees with it rather than contradicting it.
    this.ledger.set(entity.order_id, {
      providerPaymentId: entity.id,
      status,
      amountPaise: entity.amount ?? 0,
      method: event.method,
      failureReason: event.failureReason,
    });

    return event;
  }

  fetchPayment(providerOrderId: string): Promise<PaymentSnapshot | null> {
    return Promise.resolve(this.ledger.get(providerOrderId) ?? null);
  }

  /**
   * Sends money back (§1.8.2).
   *
   * Keyed by idempotency key, so a retried refund returns the first one rather
   * than issuing a second. That is the property that matters most here: every
   * other mistake in this file costs a test, and this one would cost real
   * money twice.
   *
   * Answers `PROCESSING`, like the real gateway. A mock that returned
   * `COMPLETED` would let the whole system be built around an assumption the
   * real one breaks — refunds settle over days, not in a request.
   */
  refund(input: RefundRequest): Promise<RefundResult> {
    const already = this.refunds.get(input.idempotencyKey);
    if (already) return Promise.resolve(already);

    const result: RefundResult = {
      providerRefundId: `rfnd_mock${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      status: 'PROCESSING',
      amountPaise: input.amountPaise,
    };

    this.refunds.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  /**
   * Test seam: the customer paid, and the webhook is about to go missing.
   *
   * Not part of `PaymentProvider` — the live implementation has no equivalent,
   * because the real gateway's ledger is the real gateway's.
   */
  /** Test seam: the gateway finished a refund it had accepted. */
  pretendRefundSettled(idempotencyKey: string): void {
    const existing = this.refunds.get(idempotencyKey);
    if (existing) this.refunds.set(idempotencyKey, { ...existing, status: 'COMPLETED' });
  }

  pretendCustomerPaid(providerOrderId: string, providerPaymentId?: string): void {
    const existing = this.ledger.get(providerOrderId);
    if (!existing) return;

    this.ledger.set(providerOrderId, {
      ...existing,
      providerPaymentId: providerPaymentId ?? `pay_mock${randomUUID().slice(0, 12)}`,
      status: PaymentStatus.CAPTURED,
    });
  }

  private statusFor(event: string, entityStatus?: string): PaymentStatus | null {
    if (event === 'payment.captured' || entityStatus === 'captured') {
      return PaymentStatus.CAPTURED;
    }
    if (event === 'payment.authorized' || entityStatus === 'authorized') {
      return PaymentStatus.AUTHORISED;
    }
    if (event === 'payment.failed' || entityStatus === 'failed') {
      return PaymentStatus.FAILED;
    }
    // An event we do not act on — a refund, a settlement notice. Recording it
    // and doing nothing is right; guessing is not.
    return null;
  }

  private methodFor(method: string | undefined): PaymentMethod | null {
    switch (method) {
      case 'upi':
        return PaymentMethod.UPI_INTENT;
      case 'card':
        return PaymentMethod.CARD;
      case 'wallet':
        return PaymentMethod.WALLET;
      default:
        return null;
    }
  }
}

/** The shape Razorpay posts. Only the fields this code reads. */
interface RazorpayWebhookBody {
  id?: string;
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        amount?: number;
        method?: string;
        error_description?: string;
      };
    };
  };
}
