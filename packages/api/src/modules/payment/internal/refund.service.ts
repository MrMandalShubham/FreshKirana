import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  type PaymentProvider,
  type RefundReason,
  RefundRoute,
  RefundStatus,
  etaFor,
  isFullyRefunded,
  refundableAmountPaise,
  routeFor,
} from '@freshkirana/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { PAYMENT_PROVIDER } from './razorpay.provider';
import { payment, refund } from '../schema';

export interface IssueRefundInput {
  orderId: string;
  accountId: string;
  amountPaise: number;
  reason: RefundReason;
  paymentMethod: PaymentMethod;
  /** Derived from the intent, never generated (rule R4). */
  idempotencyKey: string;
  orderLineId?: string;
  /** §1.8.2 allows store credit only when the customer asks for it. */
  storeCredit?: boolean;
  issuedBy?: string;
  note?: string;
}

export interface RefundView {
  id: string;
  amountPaise: number;
  status: string;
  route: string;
  reason: string;
  expectedByMinDays: number;
  expectedByMaxDays: number;
  initiatedAt: string;
  completedAt: string | null;
}

/**
 * Money going back (spec §1.8.2).
 *
 * ## Why the row is written before the gateway is called
 *
 * A refund that the gateway accepted and we did not record is money gone with
 * no trace — the worst outcome available here, and unrecoverable without
 * reading the provider's dashboard by hand. So the row is written first, in
 * PENDING, and only then does anything leave. A crash between the two leaves a
 * refund we owe and know about, which the sweeper finishes.
 *
 * The reverse order optimises for the case that does not matter (a refund
 * nobody asked for) at the cost of the case that does.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Owes the customer money, and starts getting it to them.
   *
   * Idempotent on the key: "cancel order X" is one intent however many times it
   * is submitted, and the unique index is what enforces that rather than the
   * check above it — two concurrent submissions both see no existing row.
   */
  async issue(input: IssueRefundInput): Promise<RefundView> {
    const existing = await this.byIdempotencyKey(input.idempotencyKey);
    if (existing) return this.render(existing);

    if (input.amountPaise <= 0) {
      throw new ConflictException({
        message: 'There is nothing to refund on this order',
        code: 'NOTHING_TO_REFUND',
      });
    }

    const route = routeFor(input.paymentMethod, input.storeCredit ?? false);

    // The captured payment this reverses. Null for cash — there is no rail to
    // reverse, and §1.8.2 routes it to a transfer or store credit instead.
    const captured =
      route === RefundRoute.ORIGINAL_METHOD
        ? await this.capturedPaymentFor(input.orderId)
        : null;

    let created;
    try {
      const rows = await this.db
        .insert(refund)
        .values({
          orderId: input.orderId,
          accountId: input.accountId,
          paymentId: captured?.id ?? null,
          amountPaise: input.amountPaise,
          reason: input.reason,
          route,
          status: RefundStatus.PENDING,
          orderLineId: input.orderLineId ?? null,
          idempotencyKey: input.idempotencyKey,
          issuedBy: input.issuedBy ?? null,
          note: input.note ?? null,
        })
        .returning();

      created = rows[0]!;
    } catch (error) {
      // The other submission won the race. Its refund is the refund.
      const winner = await this.byIdempotencyKey(input.idempotencyKey);
      if (winner) return this.render(winner);
      throw error;
    }

    // Only now does money move.
    if (route === RefundRoute.ORIGINAL_METHOD && captured?.providerPaymentId) {
      await this.send(created.id, captured.providerPaymentId, input);
    }

    const settled = await this.byId(created.id);
    return this.render(settled ?? created);
  }

  /**
   * Hands one refund to the gateway.
   *
   * Failures are recorded, not thrown: a refund the gateway refused is still a
   * refund we owe, and losing the row would lose the obligation with it.
   */
  private async send(
    refundId: string,
    providerPaymentId: string,
    input: IssueRefundInput,
  ): Promise<void> {
    const result = await this.provider.refund({
      providerPaymentId,
      amountPaise: input.amountPaise,
      idempotencyKey: input.idempotencyKey,
      notes: { orderId: input.orderId, reason: input.reason },
    });

    await this.db
      .update(refund)
      .set({
        providerRefundId: result.providerRefundId || null,
        status:
          result.status === 'FAILED'
            ? RefundStatus.FAILED
            : result.status === 'COMPLETED'
              ? RefundStatus.COMPLETED
              : RefundStatus.PROCESSING,
        failureReason: result.failureReason ?? null,
        completedAt: result.status === 'COMPLETED' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(refund.id, refundId));

    if (result.status !== 'FAILED') {
      await this.updatePaymentStatus(input.orderId);
    } else {
      this.logger.error(
        `Refund ${refundId} was refused by the gateway: ${result.failureReason ?? 'no reason given'}`,
      );
    }
  }

  /**
   * Moves the payment to PARTIALLY_REFUNDED or REFUNDED (§2.6.2).
   *
   * Computed from the refund rows rather than incremented, because a counter
   * that drifts cannot be reconciled against anything — the same argument the
   * reservation ledger makes in §2.5.
   */
  private async updatePaymentStatus(orderId: string): Promise<void> {
    const captured = await this.capturedPaymentFor(orderId);
    if (!captured) return;

    const refunded = await this.totalRefundedPaise(orderId);

    await this.db
      .update(payment)
      .set({
        status: isFullyRefunded(captured.amountPaise, refunded)
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
        updatedAt: new Date(),
      })
      .where(eq(payment.id, captured.id));
  }

  /**
   * What has already gone back on this order.
   *
   * Excludes failed refunds: a refund the gateway refused did not happen, and
   * counting it would silently reduce what the customer is still owed.
   */
  async totalRefundedPaise(orderId: string): Promise<number> {
    const rows = await this.db
      .select({
        total: sql<number>`coalesce(sum(${refund.amountPaise}), 0)::int`,
      })
      .from(refund)
      .where(
        and(eq(refund.orderId, orderId), sql`${refund.status} <> ${RefundStatus.FAILED}`),
      );

    return Number(rows[0]?.total ?? 0);
  }

  /** What is left to give back, after fees and earlier refunds. */
  async remainingPaise(
    orderId: string,
    paidPaise: number,
    feePaise = 0,
  ): Promise<number> {
    const already = await this.totalRefundedPaise(orderId);
    return refundableAmountPaise(paidPaise, already, feePaise);
  }

  async forOrder(orderId: string): Promise<RefundView[]> {
    const rows = await this.db
      .select()
      .from(refund)
      .where(eq(refund.orderId, orderId))
      .orderBy(desc(refund.initiatedAt));

    return rows.map((row) => this.render(row));
  }

  /**
   * Refunds the gateway accepted but never confirmed.
   *
   * The same reasoning as the payment reconciliation sweep: a refund stuck in
   * PROCESSING is a customer waiting for money, and nothing about it looks like
   * an error from the inside.
   */
  async stale(olderThanMinutes = 60, limit = 200) {
    return this.db
      .select()
      .from(refund)
      .where(
        and(
          eq(refund.status, RefundStatus.PROCESSING),
          // The database's clock, like every other sweep — `initiatedAt` is
          // written by Postgres, and comparing it against this process's clock
          // means two clocks, or on Cloud Run one per instance.
          sql`${refund.initiatedAt} < now() - make_interval(mins => ${olderThanMinutes}::int)`,
        ),
      )
      .limit(limit);
  }

  async markCompleted(refundId: string): Promise<void> {
    await this.db
      .update(refund)
      .set({
        status: RefundStatus.COMPLETED,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(refund.id, refundId), sql`${refund.status} <> ${RefundStatus.COMPLETED}`),
      );
  }

  // -------------------------------------------------------------------------

  private async capturedPaymentFor(
    orderId: string,
    tx: Transaction | Database = this.db,
  ) {
    const rows = await tx
      .select()
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .orderBy(desc(payment.attempt));

    // The captured one, not the latest: an order whose first attempt failed and
    // whose second succeeded has both, and only one of them holds money.
    return (
      rows.find(
        (row) =>
          row.status === PaymentStatus.CAPTURED ||
          row.status === PaymentStatus.PARTIALLY_REFUNDED,
      ) ?? null
    );
  }

  private async byIdempotencyKey(key: string) {
    const rows = await this.db
      .select()
      .from(refund)
      .where(eq(refund.idempotencyKey, key))
      .limit(1);

    return rows[0] ?? null;
  }

  private async byId(id: string) {
    const rows = await this.db.select().from(refund).where(eq(refund.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * What the customer sees.
   *
   * A range of days rather than a date, because the gateway controls the timing
   * and routinely takes the long end — a precise promise this system cannot
   * keep turns a late refund into a second failure.
   */
  private render(row: typeof refund.$inferSelect): RefundView {
    const eta = etaFor(row.route as RefundRoute);

    return {
      id: row.id,
      amountPaise: row.amountPaise,
      status: row.status,
      route: row.route,
      reason: row.reason,
      expectedByMinDays: eta.minDays,
      expectedByMaxDays: eta.maxDays,
      initiatedAt: row.initiatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
