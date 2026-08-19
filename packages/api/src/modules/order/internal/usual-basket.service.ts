import { Inject, Injectable } from '@nestjs/common';
import {
  type BasketPredictor,
  OrderStatus,
  type PredictedBasket,
  type PurchaseRecord,
  predictUsualBasket,
} from '@freshkirana/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { order, orderLine } from '../schema';

export interface BuyAgainItem {
  masterProductId: string;
  vendorOfferId: string;
  name: string;
  slug: string;
  netQuantity: number;
  uom: string;
  quantity: number;
  lastOrderedAt: Date;
  timesOrdered: number;
}

/**
 * "Your usual basket" and "Buy again" (spec §0.3, §2.17.1, §4.2).
 *
 * ## This is the product, not a feature
 *
 * §0.3 names repeat-basket intelligence as one of the two things that make
 * FreshKirana something other than a worse Blinkit. §2.17.1 guardrail 1 goes
 * further: it is a SQL query, it is not AI, and filing it under "do later"
 * launches a generic marketplace.
 *
 * ## Which orders count
 *
 * Orders that were actually fulfilled, plus ones still in flight. A cancelled
 * order is not evidence of a habit — the shopper explicitly said no — and
 * counting it would put the thing they rejected back in front of them every
 * week.
 */
@Injectable()
export class UsualBasketService implements BasketPredictor {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Orders that count as evidence of what somebody buys. */
  private static readonly COUNTS_AS_A_PURCHASE = [
    OrderStatus.AWAITING_VENDOR,
    OrderStatus.ACCEPTED,
    OrderStatus.PICKING,
    OrderStatus.SUBSTITUTION_PENDING,
    OrderStatus.PACKED,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.DISPATCHED,
    OrderStatus.DELIVERED,
    OrderStatus.COMPLETED,
  ];

  async predict(accountId: string, now = new Date()): Promise<PredictedBasket> {
    const purchases = await this.purchaseHistory(accountId);

    return {
      accountId,
      items: predictUsualBasket(purchases, now),
      // Named so §5.2 can compare this against whatever replaces it, rather
      // than discovering later that nobody recorded which one was running.
      strategy: 'frequency-x-median-interval',
    };
  }

  /**
   * Every line of every order that counts, oldest first.
   *
   * Read whole rather than aggregated in SQL: the ranking is tuned often and
   * `predictUsualBasket` is pure, so keeping the arithmetic in TypeScript makes
   * it testable without a database. At the volumes one household generates —
   * hundreds of lines, not millions — this is the cheaper trade.
   */
  private async purchaseHistory(accountId: string): Promise<PurchaseRecord[]> {
    const rows = await this.db
      .select({
        masterProductId: orderLine.masterProductId,
        quantity: orderLine.quantity,
        purchasedAt: order.placedAt,
      })
      .from(orderLine)
      .innerJoin(order, eq(orderLine.orderId, order.id))
      .where(
        and(
          eq(order.accountId, accountId),
          inArray(order.status, UsualBasketService.COUNTS_AS_A_PURCHASE),
        ),
      )
      .orderBy(order.placedAt);

    return rows.map((row) => ({
      masterProductId: row.masterProductId,
      quantity: row.quantity,
      purchasedAt: row.purchasedAt,
    }));
  }

  /**
   * "Buy again" — everything bought before, most recent first (§4.2).
   *
   * Deliberately simpler than the usual basket. This is a list to browse, not a
   * prediction: no thresholds, no confidence, and a single purchase belongs
   * here even though it never belongs in the basket.
   */
  async buyAgain(accountId: string, limit = 20): Promise<BuyAgainItem[]> {
    const rows = await this.db
      .select({
        masterProductId: orderLine.masterProductId,
        vendorOfferId: sql<string>`(array_agg(${orderLine.vendorOfferId} order by ${order.placedAt} desc))[1]`,
        name: sql<string>`(array_agg(${orderLine.name} order by ${order.placedAt} desc))[1]`,
        slug: sql<string>`(array_agg(${orderLine.slug} order by ${order.placedAt} desc))[1]`,
        netQuantity: sql<number>`(array_agg(${orderLine.netQuantity} order by ${order.placedAt} desc))[1]`,
        uom: sql<string>`(array_agg(${orderLine.uom} order by ${order.placedAt} desc))[1]`,
        quantity: sql<number>`(array_agg(${orderLine.quantity} order by ${order.placedAt} desc))[1]`,
        lastOrderedAt: sql<Date>`max(${order.placedAt})`,
        timesOrdered: sql<number>`count(*)::int`,
      })
      .from(orderLine)
      .innerJoin(order, eq(orderLine.orderId, order.id))
      .where(
        and(
          eq(order.accountId, accountId),
          inArray(order.status, UsualBasketService.COUNTS_AS_A_PURCHASE),
        ),
      )
      .groupBy(orderLine.masterProductId)
      .orderBy(desc(sql`max(${order.placedAt})`))
      .limit(Math.min(limit, 50));

    return rows.map((row) => ({
      ...row,
      lastOrderedAt: new Date(row.lastOrderedAt),
      netQuantity: Number(row.netQuantity),
      quantity: Number(row.quantity),
    }));
  }

  /**
   * The offer each predicted product was last bought as.
   *
   * The prediction is about *products*; a basket needs *offers*. Starting from
   * what they actually bought last time keeps the store and the pack size
   * familiar — and whether that offer is still purchasable today is the
   * caller's problem, because only it knows which store the basket is pinned
   * to (decision D2).
   */
  async lastOffersFor(
    accountId: string,
    masterProductIds: readonly string[],
  ): Promise<Map<string, { vendorOfferId: string; vendorId: string; name: string }>> {
    if (masterProductIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        masterProductId: orderLine.masterProductId,
        vendorOfferId: sql<string>`(array_agg(${orderLine.vendorOfferId} order by ${order.placedAt} desc))[1]`,
        vendorId: sql<string>`(array_agg(${order.vendorId} order by ${order.placedAt} desc))[1]`,
        name: sql<string>`(array_agg(${orderLine.name} order by ${order.placedAt} desc))[1]`,
      })
      .from(orderLine)
      .innerJoin(order, eq(orderLine.orderId, order.id))
      .where(
        and(
          eq(order.accountId, accountId),
          inArray(orderLine.masterProductId, [...masterProductIds]),
          inArray(order.status, UsualBasketService.COUNTS_AS_A_PURCHASE),
        ),
      )
      .groupBy(orderLine.masterProductId);

    return new Map(rows.map((row) => [row.masterProductId, row]));
  }
}
