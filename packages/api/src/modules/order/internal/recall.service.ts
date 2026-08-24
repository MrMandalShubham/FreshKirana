import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationTemplate,
  RecallStatus,
  type RecallReason,
} from '@freshkirana/contracts';
import { eq, inArray } from 'drizzle-orm';
import { BatchService, RecallRegistry } from '../../offer/contracts';
import { NotificationService } from '../../notification/contracts';
import { type Database, createDatabase } from '../../../db';
import { order, orderLine } from '../schema';

export interface AffectedOrder {
  orderId: string;
  orderNumber: string;
  accountId: string;
  recipientName: string;
  recipientPhone: string;
  branchId: string;
  status: string;
  placedAt: Date;
  lineName: string;
  /** True when it already reached the customer — the urgent half. */
  delivered: boolean;
}

export interface RecallReport {
  recallId: string;
  masterProductId: string;
  batchNo: string;
  reason: string;
  raisedAt: string;
  batchesAffected: number;
  ordersAffected: number;
  /** Of those, how many are already in somebody's kitchen. */
  alreadyDelivered: number;
  customersNotified: number;
  orders: AffectedOrder[];
}

/** Orders past this point have reached the customer. */
const DELIVERED_STATUSES = ['DELIVERED', 'COMPLETED', 'RETURN_REQUESTED', 'RETURNED'];

/**
 * Pulling an unsafe lot (spec §1.7.3).
 *
 * ## The order of operations is the whole design
 *
 * 1. **Block further sale.** Every minute a recalled batch stays sellable is
 *    another customer receiving it. This happens before anything else, and it
 *    happens even if the rest fails.
 * 2. **Find who has it.** Orders carry the batch they were picked from, which
 *    is the only reason this question is answerable at all.
 * 3. **Tell them**, delivered orders first.
 * 4. **Produce the report** FSSAI will ask for.
 *
 * Steps 2 to 4 are re-runnable. A recall that half-completed because a message
 * provider was down must be resumable rather than restarted, because restarting
 * means notifying the first half twice.
 */
@Injectable()
export class RecallService {
  private readonly logger = new Logger(RecallService.name);
  private readonly db: Database = createDatabase();

  constructor(
    private readonly batches: BatchService,
    private readonly recalls: RecallRegistry,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Raises a recall and blocks the lot immediately.
   *
   * Notification happens separately, so a slow or failing message provider
   * cannot delay the one step that stops the harm spreading.
   */
  async raise(input: {
    masterProductId: string;
    batchNo: string;
    reason: RecallReason;
    raisedBy: string;
    note?: string;
  }): Promise<RecallReport> {
    const affectedBatches = await this.batches.findByBatchNo(
      input.masterProductId,
      input.batchNo,
    );

    // Blocked first, and before the recall row exists: if this method fails
    // halfway, the safe half is the half that already happened.
    const blocked = await this.batches.recallBatches(
      affectedBatches.map((batch) => batch.id),
    );

    const raised = await this.recalls.open({
      masterProductId: input.masterProductId,
      batchNo: input.batchNo,
      reason: input.reason,
      raisedBy: input.raisedBy,
      note: input.note ?? null,
      batchesAffected: blocked,
    });

    this.logger.warn(
      `Recall ${raised.id}: blocked ${blocked} batch(es) of ${input.batchNo}`,
    );

    return this.report(raised.id);
  }

  /**
   * Tells everyone who received the lot (§1.7.3).
   *
   * Delivered orders first. Somebody who already has it in their kitchen needs
   * to know now; somebody whose order has not been picked yet is not at risk,
   * and their batch has already been blocked from being picked.
   */
  async notify(recallId: string): Promise<RecallReport> {
    const found = await this.recalls.byId(recallId);
    if (!found) throw new NotFoundException('No such recall');

    const affected = await this.affectedOrders(found.masterProductId, found.batchNo);

    const urgentFirst = [...affected].sort(
      (a, b) => Number(b.delivered) - Number(a.delivered),
    );

    let notified = 0;

    for (const entry of urgentFirst) {
      try {
        await this.notifications.send({
          channel: NotificationChannel.WHATSAPP,
          template: NotificationTemplate.PRODUCT_RECALL,
          toPhone: entry.recipientPhone,
          accountId: entry.accountId,
          orderId: entry.orderId,
          // The store that sold it. §2.12's evidence log is per-branch, and a
          // recall is exactly the kind of thing somebody asks about later.
          branchId: entry.branchId,
          payload: {
            orderNumber: entry.orderNumber,
            item: entry.lineName,
            batchNo: found.batchNo,
            delivered: entry.delivered,
          },
        });

        notified += 1;
      } catch (error) {
        // One unreachable number must not stop the rest. A recall that halts on
        // the first bad phone is a recall that reaches nobody after it.
        this.logger.error(
          `Recall ${recallId}: could not notify order ${entry.orderId}: ${String(error)}`,
        );
      }
    }

    await this.recalls.markNotified(recallId, {
      ordersAffected: affected.length,
      customersNotified: notified,
    });

    return this.report(recallId);
  }

  /**
   * The regulator-ready record (§1.7.3).
   *
   * Rebuilt from the orders rather than read from counters, so it is true when
   * it is asked for rather than true when it was written.
   */
  async report(recallId: string): Promise<RecallReport> {
    const found = await this.recalls.byId(recallId);
    if (!found) throw new NotFoundException('No such recall');

    const orders = await this.affectedOrders(found.masterProductId, found.batchNo);

    return {
      recallId: found.id,
      masterProductId: found.masterProductId,
      batchNo: found.batchNo,
      reason: found.reason,
      raisedAt: found.raisedAt.toISOString(),
      batchesAffected: found.batchesAffected,
      ordersAffected: orders.length,
      alreadyDelivered: orders.filter((entry) => entry.delivered).length,
      customersNotified: found.customersNotified,
      orders,
    };
  }

  async close(recallId: string): Promise<RecallReport> {
    await this.recalls.close(recallId);
    return this.report(recallId);
  }

  async list(status?: RecallStatus) {
    return this.recalls.list(status);
  }

  // -------------------------------------------------------------------------

  /**
   * Every order containing the lot.
   *
   * Found through `order_line.offer_batch_id`, recorded when the line was
   * picked. Without that column this query does not exist and neither does
   * FSSAI compliance — which is the argument for batches being rows.
   */
  private async affectedOrders(
    masterProductId: string,
    batchNo: string,
  ): Promise<AffectedOrder[]> {
    const batches = await this.batches.findByBatchNo(masterProductId, batchNo);
    if (batches.length === 0) return [];

    const rows = await this.db
      .select({
        orderId: order.id,
        orderNumber: order.orderNumber,
        accountId: order.accountId,
        branchId: order.branchId,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        status: order.status,
        placedAt: order.placedAt,
        lineName: orderLine.name,
      })
      .from(orderLine)
      .innerJoin(order, eq(orderLine.orderId, order.id))
      .where(
        inArray(
          orderLine.offerBatchId,
          batches.map((batch) => batch.id),
        ),
      );

    return rows.map((row) => ({
      ...row,
      delivered: DELIVERED_STATUSES.includes(row.status),
    }));
  }
}
