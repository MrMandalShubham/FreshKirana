import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnalyticsEvent,
  DEFAULT_WEIGHT_TOLERANCE_PCT,
  NotificationChannel,
  NotificationTemplate,
  OrderStatus,
  type PaymentMethod,
  PaymentMethod as PaymentMethods,
  QuantityMode,
  RefundReason,
  Uom,
  GRAMS_PER_KG,
  codCollectablePaise,
  quantityModeFor,
  weighLine,
} from '@freshkirana/contracts';
import { eq } from 'drizzle-orm';
import { AnalyticsService } from '../../analytics/contracts';
import { NotificationService } from '../../notification/contracts';
import { RefundService } from '../../payment/contracts';
import { type Database, createDatabase } from '../../../db';
import { order, orderLine } from '../schema';
import { OrderService } from './order.service';

export interface WeighedLineView {
  orderLineId: string;
  actualGrams: number;
  actualLineTotalPaise: number;
  deltaPaise: number;
  outsideTolerance: boolean;
  absorbed: boolean;
  /** True when §1.7.1 wants the customer asked before this is charged. */
  needsConsent: boolean;
}

/**
 * Putting groceries on a scale (spec §1.7.1).
 *
 * Loose goods are ordered by intent — "1 kg tomatoes" — and delivered by actual
 * weight. Everything downstream follows from the number the picker types: what
 * the customer is charged, what goes back to them, what the rider collects, and
 * what the tax invoice says.
 *
 * ## Why the money moves the way it does
 *
 * §2.10.2 established during P3.2 that **UPI cannot authorise then capture
 * less** — it captures immediately, in full. So the auth-and-adjust flow
 * §1.7.1 describes for cards is not available for the method almost every
 * Indian customer uses. What is left is the fallback the spec names in the same
 * breath: capture the estimate, refund the difference. That is what happens
 * here, and it is why P3.5's refund path had to exist first.
 *
 * Cash is simpler and better: nothing has been taken, so the rider simply
 * collects the real number, rounded to something a person can hand over.
 */
@Injectable()
export class WeighingService {
  private readonly logger = new Logger(WeighingService.name);
  private readonly db: Database = createDatabase();

  constructor(
    private readonly orders: OrderService,
    private readonly refunds: RefundService,
    private readonly notifications: NotificationService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Records what the scale said.
   *
   * Refuses a packaged line outright: a sealed 1 kg bag of atta is not weighed,
   * and accepting a number for it would put a fiction into the invoice that
   * §1.7.1 says must be generated on the actual amount.
   */
  async weigh(input: {
    orderId: string;
    orderLineId: string;
    vendorId: string;
    actualGrams: number;
    consented?: boolean;
  }): Promise<WeighedLineView> {
    const found = await this.orders.findById(input.orderId);
    if (!found || found.vendorId !== input.vendorId) {
      // Scoped like every other vendor route (§3.2).
      throw new NotFoundException('No such order');
    }

    if (found.status !== OrderStatus.PICKING) {
      throw new ConflictException({
        message: 'This order is not being picked',
        code: 'NOT_PICKING',
        status: found.status,
      });
    }

    const line = found.lines.find((candidate) => candidate.id === input.orderLineId);
    if (!line) throw new NotFoundException('No such line on this order');

    if (!line.isVariableWeight) {
      throw new ConflictException({
        message: 'This item is sold by the pack, not by weight',
        code: 'NOT_SOLD_BY_WEIGHT',
      });
    }

    const pricePerKgPaise = line.pricePerKgPaise ?? this.impliedPricePerKg(line);
    const tolerancePct = line.weightTolerancePct ?? DEFAULT_WEIGHT_TOLERANCE_PCT;

    const outcome = weighLine({
      orderedGrams: orderedGramsOf(line),
      actualGrams: input.actualGrams,
      pricePerKgPaise,
      tolerancePct,
    });

    /*
     * Outside the band, ask first (§1.7.1 guardrails).
     *
     * The weight is *not* recorded in that case. Recording it and asking
     * afterwards would mean the order briefly carries a price nobody agreed to,
     * and whatever reads the order in that window — an invoice, a rider's
     * collectable, a refund sweep — would act on it.
     */
    if (outcome.outsideTolerance && !input.consented) {
      await this.askAboutWeight(
        found,
        line,
        input.actualGrams,
        outcome.actualLineTotalPaise,
      );

      return {
        orderLineId: line.id,
        actualGrams: input.actualGrams,
        actualLineTotalPaise: outcome.actualLineTotalPaise,
        deltaPaise: outcome.deltaPaise,
        outsideTolerance: true,
        absorbed: false,
        needsConsent: true,
      };
    }

    await this.db
      .update(orderLine)
      .set({
        actualGrams: input.actualGrams,
        pricePerKgPaise,
        weightTolerancePct: tolerancePct,
        lineTotalPaise: outcome.actualLineTotalPaise,
        weighedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orderLine.id, line.id));

    await this.settle(found, line.id, outcome.deltaPaise, outcome.absorbed);
    await this.recomputeOrderTotals(input.orderId);

    void this.analytics.emit(AnalyticsEvent.WEIGHT_RECORDED, {
      accountId: found.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: {
        orderId: input.orderId,
        deltaPaise: outcome.deltaPaise,
        outsideTolerance: outcome.outsideTolerance,
        absorbed: outcome.absorbed,
      },
    });

    return {
      orderLineId: line.id,
      actualGrams: input.actualGrams,
      actualLineTotalPaise: outcome.actualLineTotalPaise,
      deltaPaise: outcome.deltaPaise,
      outsideTolerance: outcome.outsideTolerance,
      absorbed: outcome.absorbed,
      needsConsent: false,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Moves the money, in whichever direction the scale pointed.
   *
   * Prepaid overpayment goes back through P3.5's refund path — the customer was
   * charged the estimate at checkout because UPI captures in full (§2.10.2), so
   * a lighter pack means they are owed the difference.
   *
   * An *underpayment* is not collected. There is no mechanism to charge more
   * against a completed UPI capture without asking, and §1.7.1 only permits
   * more within the tolerance band the customer already accepted. The platform
   * absorbs it, which is the same asymmetry as the small-refund rule.
   */
  private async settle(
    parent: { id: string; accountId: string; paymentMethod: string },
    orderLineId: string,
    deltaPaise: number,
    absorbed: boolean,
  ): Promise<void> {
    if (parent.paymentMethod === PaymentMethods.COD) return;
    if (deltaPaise <= 0 || absorbed) return;

    await this.refunds
      .issue({
        orderId: parent.id,
        accountId: parent.accountId,
        amountPaise: deltaPaise,
        reason: RefundReason.WEIGHT_SHORTFALL,
        paymentMethod: parent.paymentMethod as PaymentMethod,
        orderLineId,
        // Derived from the line and the amount, so re-weighing the same line to
        // the same number cannot refund twice (rule R4).
        idempotencyKey: `weight:line:${orderLineId}:${deltaPaise}`,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Could not refund the weight difference on ${orderLineId}: ${String(error)}`,
        );
      });
  }

  /**
   * Recomputes the order, and what the rider collects.
   *
   * §1.7.1 wants the cash figure rounded to the nearest rupee and pushed to the
   * rider *and* the customer before dispatch — settling 47 paise at a doorstep
   * is a fiction, and a customer who hears the number only when the rider
   * arrives has no chance to query it.
   */
  private async recomputeOrderTotals(orderId: string): Promise<void> {
    const refreshed = await this.orders.findById(orderId);
    if (!refreshed) return;

    const itemsSubtotalPaise = refreshed.lines.reduce(
      (sum, line) => sum + line.lineTotalPaise,
      0,
    );

    const grandTotalPaise =
      itemsSubtotalPaise +
      refreshed.deliveryFeePaise +
      refreshed.smallBasketFeePaise +
      refreshed.packagingFeePaise;

    const isCash = refreshed.paymentMethod === PaymentMethods.COD;

    await this.db
      .update(order)
      .set({
        itemsSubtotalPaise,
        grandTotalPaise,
        // Only cash has something to collect. A prepaid order was charged at
        // checkout and settles by refund instead.
        codCollectablePaise: isCash ? codCollectablePaise(grandTotalPaise) : 0,
        updatedAt: new Date(),
      })
      .where(eq(order.id, orderId));
  }

  /** Asks before charging for a weight nobody agreed to (§1.7.1). */
  private async askAboutWeight(
    parent: {
      id: string;
      accountId: string;
      vendorId: string;
      orderNumber: string;
      recipientPhone: string;
    },
    line: { id: string; name: string; netQuantity: number; quantity: number },
    actualGrams: number,
    actualLineTotalPaise: number,
  ): Promise<void> {
    await this.notifications.send({
      channel: NotificationChannel.WHATSAPP,
      template: NotificationTemplate.WEIGHT_CONSENT,
      toPhone: parent.recipientPhone,
      accountId: parent.accountId,
      orderId: parent.id,
      vendorId: parent.vendorId,
      payload: {
        orderNumber: parent.orderNumber,
        item: line.name,
        orderedGrams: line.netQuantity * line.quantity,
        actualGrams,
        newLineTotalPaise: actualLineTotalPaise,
        orderLineId: line.id,
      },
    });
  }

  /**
   * The per-kilogram price implied by what the customer was charged.
   *
   * A fallback for lines placed before P4.2 added the column. Derived from the
   * line rather than the live offer, because the customer agreed to the price
   * they were shown — not the one in force when a picker reached the shelf.
   */
  private impliedPricePerKg(line: {
    unitPricePaise: number;
    netQuantity: number;
    uom: string;
  }): number {
    const declaredGrams = toGrams(line.netQuantity, line.uom);
    if (declaredGrams <= 0) return 0;

    return Math.round((line.unitPricePaise * GRAMS_PER_KG) / declaredGrams);
  }
}

/**
 * How much was ordered, in grams.
 *
 * P2.1 settled what `quantity` means and this has to agree with it: on a
 * measured line the quantity *is* the amount — 1500 with uom `G` is 1.5 kg —
 * while `netQuantity` is the pack size the price is quoted against. Reading it
 * as a pack count, which is what a packaged line means, prices a kilo of
 * tomatoes as a gram.
 */
function orderedGramsOf(line: {
  quantity: number;
  netQuantity: number;
  uom: string;
  isVariableWeight: boolean;
}): number {
  return quantityModeFor(line) === QuantityMode.MEASURE
    ? toGrams(line.quantity, line.uom)
    : toGrams(line.netQuantity * line.quantity, line.uom);
}

/** Grams from a quantity in the product's own unit. */
function toGrams(amount: number, uom: string): number {
  return uom === Uom.KG ? amount * GRAMS_PER_KG : amount;
}
