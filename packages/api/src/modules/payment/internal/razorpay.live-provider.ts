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
} from '@freshkirana/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/** How long to wait on the gateway before giving up on one call. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The real Razorpay (decision B3).
 *
 * Everything that decides whether a body can be trusted — the signature scheme,
 * the webhook envelope, the status mapping — is shared with the mock and was
 * built and tested there. This class is the part that could not be: two HTTP
 * calls, and the error handling around them.
 *
 * Selected only when `RAZORPAY_KEY_ID` is set. A deployment without credentials
 * keeps the mock, which means "cannot take real payments" rather than a service
 * that will not boot.
 */
@Injectable()
export class LiveRazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  private readonly logger = new Logger('Razorpay');

  static isConfigured(): boolean {
    return Boolean(process.env['RAZORPAY_KEY_ID']?.trim());
  }

  private get keyId(): string {
    return process.env['RAZORPAY_KEY_ID'] ?? '';
  }

  private get keySecret(): string {
    return process.env['RAZORPAY_KEY_SECRET'] ?? '';
  }

  private get webhookSecret(): string {
    return process.env['RAZORPAY_WEBHOOK_SECRET'] ?? '';
  }

  /** Basic auth over the key pair, which is how Razorpay authenticates. */
  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  /**
   * Creates a Razorpay order — the handle the checkout SDK opens.
   *
   * `receipt` carries our order number so a human comparing the two dashboards
   * has something to match on. `X-Razorpay-Idempotency` means a retried request
   * returns the original order rather than creating a second payable handle for
   * one basket (rule R4).
   */
  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    const response = await this.call('/orders', {
      method: 'POST',
      headers: { 'x-razorpay-idempotency': input.idempotencyKey },
      body: {
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.orderNumber,
        notes: { paymentId: input.paymentId, orderNumber: input.orderNumber },
      },
    });

    const order = response as { id?: string };
    if (!order.id) {
      throw new Error('Razorpay accepted the order request but returned no id');
    }

    return {
      paymentId: input.paymentId,
      providerOrderId: order.id,
      amountPaise: input.amountPaise,
      currency: 'INR',
      method: input.method,
      expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
    };
  }

  /**
   * HMAC-SHA256 over the raw body, compared in constant time.
   *
   * Identical to the mock's, deliberately: this is the one piece of the live
   * provider that must not be written twice, because a difference between the
   * tested implementation and the deployed one is exactly the bug nobody finds.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature || !this.webhookSecret) return false;

    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const given = Buffer.from(signature, 'utf8');
    const mine = Buffer.from(expected, 'utf8');

    if (given.length !== mine.length) return false;
    return timingSafeEqual(given, mine);
  }

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

    return {
      providerEventId: body.id ?? `${entity.id}:${body.event}`,
      providerPaymentId: entity.id,
      providerOrderId: entity.order_id,
      status,
      amountPaise: entity.amount ?? 0,
      method: this.methodFor(entity.method),
      failureReason: entity.error_description ?? null,
      raw: body as unknown as Record<string, unknown>,
    };
  }

  /**
   * Asks Razorpay what happened to an order (§2.10.3).
   *
   * Returns null rather than throwing when the gateway cannot be reached: the
   * caller is the reconciliation loop, and one unreachable call should mean
   * "ask again next time", not "abandon the batch".
   */
  async fetchPayment(providerOrderId: string): Promise<PaymentSnapshot | null> {
    try {
      const response = await this.call(
        `/orders/${encodeURIComponent(providerOrderId)}/payments`,
        { method: 'GET' },
      );

      const payments = (response as { items?: RazorpayPaymentEntity[] }).items ?? [];
      if (payments.length === 0) return null;

      // A customer whose first attempt failed and who then paid has several
      // payments against one order. The captured one is the answer; without
      // this the first failure would look like the outcome.
      const captured = payments.find((p) => p.status === 'captured');
      const chosen = captured ?? payments[payments.length - 1]!;

      return {
        providerPaymentId: chosen.id ?? null,
        status: this.statusFor('', chosen.status) ?? PaymentStatus.PENDING,
        amountPaise: chosen.amount ?? 0,
        method: this.methodFor(chosen.method),
        failureReason: chosen.error_description ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Could not fetch ${providerOrderId} from Razorpay: ${String(error)}`,
      );
      return null;
    }
  }

  private async call(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<unknown> {
    const response = await fetch(`${RAZORPAY_API}${path}`, {
      method: init.method,
      headers: {
        authorization: this.authHeader,
        'content-type': 'application/json',
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: { description?: string; code?: string };
    } | null;

    if (!response.ok) {
      // The gateway's own description, because "Razorpay returned 400" tells
      // whoever is on call nothing about which field it disliked.
      const detail = payload?.error?.description ?? `HTTP ${response.status}`;
      throw new Error(`Razorpay ${init.method} ${path} failed: ${detail}`);
    }

    return payload;
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

interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  status?: string;
  amount?: number;
  method?: string;
  error_description?: string;
}

interface RazorpayWebhookBody {
  id?: string;
  event: string;
  payload?: { payment?: { entity?: RazorpayPaymentEntity } };
}
