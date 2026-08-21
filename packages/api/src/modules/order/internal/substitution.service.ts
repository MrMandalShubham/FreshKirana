import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnalyticsEvent,
  MAX_SUBSTITUTE_OPTIONS,
  NotificationChannel,
  NotificationTemplate,
  OrderLineStatus,
  OrderStatus,
  type PaymentMethod,
  RefundReason,
  SUBSTITUTION_WINDOW_MINUTES,
  type SubstituteCandidate,
  SubstitutionPreference,
  Role,
  SubstitutionStatus,
  TIMEOUT_FALLBACK,
  priceSubstitution,
} from '@freshkirana/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AnalyticsService } from '../../analytics/contracts';
import { NotificationService } from '../../notification/contracts';
import { RuleSubstituteRanker } from '../../offer/contracts';
import { RefundService } from '../../payment/contracts';
import { type Database, createDatabase } from '../../../db';
import { orderLine, substitution } from '../schema';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';

export interface RaisedSubstitution {
  id: string;
  status: SubstitutionStatus;
  options: SubstituteCandidate[];
  /** Set only while the customer is being asked. */
  expiresAt: string | null;
}

/**
 * What to do when the shop has run out (spec §1.7.2).
 *
 * Between five and fifteen per cent of lines go out of stock between order and
 * picking. Without this every one becomes a cancellation — the customer loses
 * the whole basket over one missing item, which is how a grocery app teaches
 * people to go back to the shop.
 *
 * The customer's preference decides what happens, and the three answers are
 * genuinely different promises:
 *
 * - `AUTO_SUBSTITUTE` — send the best match and tell me.
 * - `ASK_ME` — do not decide for me; I have ten minutes.
 * - `REFUND_ITEM` — I would rather go without.
 *
 * The one thing none of them permits is charging more than was agreed.
 */
@Injectable()
export class SubstitutionService {
  private readonly logger = new Logger(SubstitutionService.name);
  private readonly db: Database = createDatabase();

  constructor(
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly ranker: RuleSubstituteRanker,
    private readonly refunds: RefundService,
    private readonly notifications: NotificationService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * The picker marks a line out of stock (§1.7.2).
   *
   * Everything follows from the customer's preference, so this is the only
   * place that reads it — a flow where each step re-decides is a flow where two
   * steps eventually disagree.
   */
  async raise(input: {
    orderId: string;
    orderLineId: string;
    vendorId: string;
  }): Promise<RaisedSubstitution> {
    const order = await this.orders.findById(input.orderId);
    if (!order) throw new NotFoundException('No such order');

    if (order.vendorId !== input.vendorId) {
      // Scoped like every other vendor route (§3.2).
      throw new NotFoundException('No such order');
    }

    const line = order.lines.find((candidate) => candidate.id === input.orderLineId);
    if (!line) throw new NotFoundException('No such line on this order');

    /*
     * Answered before the status is judged, and the order matters.
     *
     * Raising the first question moves the order to SUBSTITUTION_PENDING, so a
     * picker who taps the same line twice — a slow network, a double tap — was
     * being told the order "is not being picked". The second tap is the same
     * intent as the first, and the honest answer is the question already open.
     */
    const open = await this.openFor(input.orderLineId);
    if (open) return this.render(open);

    /*
     * A new question needs somebody in the aisle.
     *
     * SUBSTITUTION_PENDING is allowed too: an order can lose two items, and the
     * second must be raisable while the customer is still deciding about the
     * first.
     */
    if (
      order.status !== OrderStatus.PICKING &&
      order.status !== OrderStatus.SUBSTITUTION_PENDING
    ) {
      throw new ConflictException({
        message: 'This order is not being picked',
        code: 'NOT_PICKING',
        status: order.status,
      });
    }

    const preference = (order.substitutionPreference ??
      SubstitutionPreference.AUTO_SUBSTITUTE) as SubstitutionPreference;

    const options =
      preference === SubstitutionPreference.REFUND_ITEM
        ? []
        : await this.ranker.rank({
            masterProductId: line.masterProductId,
            vendorId: order.vendorId,
            quantity: line.quantity,
          });

    await this.markLine(input.orderLineId, OrderLineStatus.OUT_OF_STOCK);

    // Nothing to offer is the same as wanting nothing offered: a refund. The
    // §1.7.2 rules refuse unsafe matches outright, so "no options" is a normal
    // outcome rather than a failure — and holding the order while a picker
    // hunts for something the rules forbid helps nobody.
    if (preference === SubstitutionPreference.REFUND_ITEM || options.length === 0) {
      return this.refundLine(order, line, preference, options);
    }

    if (preference === SubstitutionPreference.AUTO_SUBSTITUTE) {
      return this.applyAutomatically(order, line, options);
    }

    return this.askCustomer(order, line, options);
  }

  /**
   * The customer picked one (§1.7.2).
   *
   * `consented` carries the one thing that lets a substitution cost more than
   * the original — and it is recorded on the row, because "explicit consent" is
   * only enforceable if somebody can point at it afterwards.
   */
  async accept(input: {
    substitutionId: string;
    accountId: string;
    vendorOfferId: string;
    consented?: boolean;
  }) {
    const found = await this.byId(input.substitutionId);
    if (!found || found.accountId !== input.accountId) {
      throw new NotFoundException('No such substitution');
    }

    if (found.status !== SubstitutionStatus.PROPOSED) {
      throw new ConflictException({
        message: 'This has already been decided',
        code: 'ALREADY_RESOLVED',
        status: found.status,
      });
    }

    const options = found.options as SubstituteCandidate[];
    const chosen = options.find((option) => option.vendorOfferId === input.vendorOfferId);

    if (!chosen) {
      // Only what they were shown. An arbitrary offer id here would let a
      // customer substitute in something the §1.7.2 rules refused.
      throw new ConflictException({
        message: 'That was not one of the options',
        code: 'NOT_AN_OPTION',
      });
    }

    return this.apply(
      found,
      chosen,
      input.consented ?? false,
      SubstitutionStatus.ACCEPTED,
    );
  }

  /** The customer would rather go without. The line is refunded (§1.7.2). */
  async reject(input: { substitutionId: string; accountId: string }) {
    const found = await this.byId(input.substitutionId);
    if (!found || found.accountId !== input.accountId) {
      throw new NotFoundException('No such substitution');
    }

    if (found.status !== SubstitutionStatus.PROPOSED) {
      throw new ConflictException({
        message: 'This has already been decided',
        code: 'ALREADY_RESOLVED',
      });
    }

    const order = await this.orders.findById(found.orderId);
    if (!order) throw new NotFoundException('No such order');

    await this.issueLineRefund(order, found.orderLineId, found.originalLineTotalPaise);
    await this.close(found.id, SubstitutionStatus.REJECTED, {
      refundPaise: found.originalLineTotalPaise,
    });
    await this.markLine(found.orderLineId, OrderLineStatus.REFUNDED);
    await this.resumePicking(found.orderId);

    void this.analytics.emit(AnalyticsEvent.SUBSTITUTION_REJECTED, {
      accountId: found.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId: found.orderId, substitutionId: found.id },
    });

    return this.byId(found.id);
  }

  /**
   * Nobody answered (§1.7.2).
   *
   * Falls back to a refund rather than to the saved preference, because
   * somebody who chose ASK_ME asked to be asked — reading their silence as
   * "go ahead" is exactly what they opted out of.
   */
  async expireOverdue() {
    const overdue = await this.db
      .select()
      .from(substitution)
      .where(
        and(
          eq(substitution.status, SubstitutionStatus.PROPOSED),
          sql`${substitution.expiresAt} < now()`,
        ),
      )
      // Oldest first, and ordered at all: an unordered `LIMIT` returns an
      // arbitrary slice, so a backlog larger than the limit can starve the
      // same rows forever — and these are people waiting.
      .orderBy(asc(substitution.expiresAt))
      .limit(200);

    let refunded = 0;
    let failed = 0;

    for (const row of overdue) {
      try {
        const order = await this.orders.findById(row.orderId);
        if (!order) continue;

        await this.issueLineRefund(order, row.orderLineId, row.originalLineTotalPaise);
        await this.close(row.id, SubstitutionStatus.TIMED_OUT, {
          refundPaise: row.originalLineTotalPaise,
        });
        await this.markLine(row.orderLineId, OrderLineStatus.REFUNDED);
        await this.resumePicking(row.orderId);

        refunded += 1;

        void this.analytics.emit(AnalyticsEvent.SUBSTITUTION_REJECTED, {
          accountId: row.accountId,
          anonId: 'account',
          sessionId: 'unknown',
          properties: { orderId: row.orderId, substitutionId: row.id, timedOut: true },
        });
      } catch (error) {
        failed += 1;
        this.logger.error(`Could not expire substitution ${row.id}: ${String(error)}`);
      }
    }

    return { considered: overdue.length, refunded, failed, fallback: TIMEOUT_FALLBACK };
  }

  async forOrder(orderId: string) {
    return this.db
      .select()
      .from(substitution)
      .where(eq(substitution.orderId, orderId))
      .orderBy(substitution.createdAt);
  }

  async byId(id: string) {
    const rows = await this.db
      .select()
      .from(substitution)
      .where(eq(substitution.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------

  private async applyAutomatically(
    order: {
      id: string;
      accountId: string;
      vendorId: string;
      orderNumber: string;
      recipientPhone: string;
    },
    line: { id: string; lineTotalPaise: number; name: string },
    options: SubstituteCandidate[],
  ): Promise<RaisedSubstitution> {
    const best = options[0]!;

    const created = await this.create({
      order,
      line,
      preference: SubstitutionPreference.AUTO_SUBSTITUTE,
      status: SubstitutionStatus.PROPOSED,
      options,
      expiresAt: null,
    });

    // Applied at once, and the customer is told rather than asked — which is
    // what AUTO_SUBSTITUTE means. §1.7.2 still lets them reject on delivery.
    return this.render(
      await this.apply(created, best, false, SubstitutionStatus.AUTO_APPLIED),
    );
  }

  private async askCustomer(
    order: {
      id: string;
      accountId: string;
      vendorId: string;
      orderNumber: string;
      recipientPhone: string;
    },
    line: { id: string; lineTotalPaise: number; name: string },
    options: SubstituteCandidate[],
  ): Promise<RaisedSubstitution> {
    const expiresAt = new Date(Date.now() + SUBSTITUTION_WINDOW_MINUTES * 60_000);

    const created = await this.create({
      order,
      line,
      preference: SubstitutionPreference.ASK_ME,
      status: SubstitutionStatus.PROPOSED,
      options,
      expiresAt,
    });

    /*
     * The picker is the actor, not the system.
     *
     * §2.6.1 gives PICKING → SUBSTITUTION_PENDING to the store, because that is
     * who caused it — somebody in an aisle found an empty shelf. Passing
     * SYSTEM_ACTOR here had the transition refused and the refusal *logged*,
     * so the customer was asked about an order that still read as "being
     * packed". A swallowed error that leaves the two disagreeing is worse than
     * a loud one.
     *
     * Skipped when the order is already there from another line on the same
     * order — that is a legitimate no-op, not a failure to hide.
     */
    const current = await this.orders.findById(order.id);
    if (current?.status === OrderStatus.PICKING) {
      await this.state.transition(
        order.id,
        OrderStatus.SUBSTITUTION_PENDING,
        { accountId: null, role: Role.VENDOR_STAFF },
        {
          vendorId: order.vendorId,
          reason: `Waiting on the customer about ${line.name}`,
        },
      );
    }

    await this.notifications.send({
      channel: NotificationChannel.WHATSAPP,
      template: NotificationTemplate.SUBSTITUTION_PROPOSE,
      toPhone: order.recipientPhone,
      accountId: order.accountId,
      orderId: order.id,
      vendorId: order.vendorId,
      payload: {
        orderNumber: order.orderNumber,
        unavailable: line.name,
        // Only what the rules allowed, and at most three (§1.7.2).
        options: options.slice(0, MAX_SUBSTITUTE_OPTIONS).map((option) => ({
          vendorOfferId: option.vendorOfferId,
          name: option.name,
          pricePaise: option.sellingPricePaise,
          reason: option.reason,
        })),
        substitutionId: created.id,
        expiresAt: expiresAt.toISOString(),
        respondWithinMinutes: SUBSTITUTION_WINDOW_MINUTES,
      },
    });

    void this.analytics.emit(AnalyticsEvent.SUBSTITUTION_PROPOSED, {
      accountId: order.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: { orderId: order.id, options: options.length },
    });

    return this.render(created);
  }

  private async refundLine(
    order: {
      id: string;
      accountId: string;
      vendorId: string;
      orderNumber: string;
      recipientPhone: string;
    },
    line: { id: string; lineTotalPaise: number; name: string },
    preference: SubstitutionPreference,
    options: SubstituteCandidate[],
  ): Promise<RaisedSubstitution> {
    const created = await this.create({
      order,
      line,
      preference,
      status: SubstitutionStatus.PROPOSED,
      options,
      expiresAt: null,
    });

    const full = await this.orders.findById(order.id);
    if (full) await this.issueLineRefund(full, line.id, line.lineTotalPaise);

    await this.close(created.id, SubstitutionStatus.REFUNDED, {
      refundPaise: line.lineTotalPaise,
    });
    await this.markLine(line.id, OrderLineStatus.REFUNDED);

    return this.render((await this.byId(created.id))!);
  }

  /**
   * Puts the substitute on the order, at a price the customer agreed to.
   *
   * The price rule lives in `contracts` so it is the same arithmetic wherever
   * it is applied — the picker's screen, the customer's, and the refund below
   * all have to agree, and three implementations would eventually not.
   */
  private async apply(
    row: {
      id: string;
      orderId: string;
      accountId: string;
      orderLineId: string;
      originalLineTotalPaise: number;
    },
    chosen: SubstituteCandidate,
    consented: boolean,
    status: SubstitutionStatus,
  ) {
    const outcome = priceSubstitution(
      row.originalLineTotalPaise,
      chosen.sellingPricePaise,
      consented,
    );

    if (outcome.needsConsent) {
      throw new ConflictException({
        message: 'That substitute costs more. We need your agreement first.',
        code: 'CONSENT_REQUIRED',
        originalPaise: row.originalLineTotalPaise,
        substitutePaise: chosen.sellingPricePaise,
      });
    }

    const order = await this.orders.findById(row.orderId);
    if (!order) throw new NotFoundException('No such order');

    if (outcome.refundPaise > 0) {
      // §1.7.2: cheaper substitute, difference back. Not "credit against the
      // next order" — money the customer did not agree to spend.
      await this.issueLineRefund(order, row.orderLineId, outcome.refundPaise);
    }

    await this.db
      .update(orderLine)
      .set({
        status: OrderLineStatus.SUBSTITUTED,
        lineTotalPaise: outcome.chargePaise,
        updatedAt: new Date(),
      })
      .where(eq(orderLine.id, row.orderLineId));

    await this.close(row.id, status, {
      chosenVendorOfferId: chosen.vendorOfferId,
      chosenName: chosen.name,
      chargedLineTotalPaise: outcome.chargePaise,
      refundPaise: outcome.refundPaise,
      consentedToHigherPrice: consented,
    });

    await this.resumePicking(row.orderId);

    void this.analytics.emit(AnalyticsEvent.SUBSTITUTION_ACCEPTED, {
      accountId: row.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: {
        orderId: row.orderId,
        automatic: status === SubstitutionStatus.AUTO_APPLIED,
        refundPaise: outcome.refundPaise,
      },
    });

    return (await this.byId(row.id))!;
  }

  private async issueLineRefund(
    order: { id: string; accountId: string; paymentMethod: string },
    orderLineId: string,
    amountPaise: number,
  ): Promise<void> {
    if (amountPaise <= 0) return;

    await this.refunds
      .issue({
        orderId: order.id,
        accountId: order.accountId,
        amountPaise,
        reason: RefundReason.ITEM_UNAVAILABLE,
        paymentMethod: order.paymentMethod as PaymentMethod,
        orderLineId,
        // Derived, so a retried decision cannot refund twice (rule R4).
        idempotencyKey: `substitution:line:${orderLineId}:${amountPaise}`,
      })
      .catch((error: unknown) => {
        // A cash order with nothing captured has nothing to refund, which is
        // not an error — the rider simply collects less at the door.
        this.logger.warn(`No refund issued for line ${orderLineId}: ${String(error)}`);
      });
  }

  /**
   * Back to picking, once nothing is outstanding.
   *
   * Only when this was the last open question: an order with two unavailable
   * lines must not resume because one of them was answered, or the picker is
   * sent back to the aisle with a question still on the customer's phone.
   */
  private async resumePicking(orderId: string): Promise<void> {
    const open = await this.db
      .select({ id: substitution.id })
      .from(substitution)
      .where(
        and(
          eq(substitution.orderId, orderId),
          eq(substitution.status, SubstitutionStatus.PROPOSED),
        ),
      )
      .limit(1);

    if (open.length > 0) return;

    const order = await this.orders.findById(orderId);
    if (!order || order.status !== OrderStatus.SUBSTITUTION_PENDING) return;

    // Same reasoning as above: §2.6.1 gives this edge to the customer and the
    // store, and the customer answering is exactly what triggers it.
    await this.state.transition(
      orderId,
      OrderStatus.PICKING,
      { accountId: order.accountId, role: Role.CUSTOMER },
      { reason: 'Substitution settled' },
    );
  }

  private async create(input: {
    order: { id: string; accountId: string };
    line: { id: string; lineTotalPaise: number };
    preference: SubstitutionPreference;
    status: SubstitutionStatus;
    options: SubstituteCandidate[];
    expiresAt: Date | null;
  }) {
    const rows = await this.db
      .insert(substitution)
      .values({
        orderId: input.order.id,
        orderLineId: input.line.id,
        accountId: input.order.accountId,
        preference: input.preference,
        status: input.status,
        options: input.options,
        originalLineTotalPaise: input.line.lineTotalPaise,
        expiresAt: input.expiresAt,
      })
      .returning();

    return rows[0]!;
  }

  private async close(
    id: string,
    status: SubstitutionStatus,
    fields: Partial<{
      chosenVendorOfferId: string;
      chosenName: string;
      chargedLineTotalPaise: number;
      refundPaise: number;
      consentedToHigherPrice: boolean;
    }> = {},
  ): Promise<void> {
    await this.db
      .update(substitution)
      .set({ status, resolvedAt: new Date(), updatedAt: new Date(), ...fields })
      .where(eq(substitution.id, id));
  }

  private async markLine(orderLineId: string, status: OrderLineStatus): Promise<void> {
    await this.db
      .update(orderLine)
      .set({ status, updatedAt: new Date() })
      .where(eq(orderLine.id, orderLineId));
  }

  private async openFor(orderLineId: string) {
    const rows = await this.db
      .select()
      .from(substitution)
      .where(
        and(
          eq(substitution.orderLineId, orderLineId),
          eq(substitution.status, SubstitutionStatus.PROPOSED),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  private render(row: {
    id: string;
    status: string;
    options: unknown;
    expiresAt: Date | null;
  }): RaisedSubstitution {
    return {
      id: row.id,
      status: row.status as SubstitutionStatus,
      options: (row.options ?? []) as SubstituteCandidate[],
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }
}
