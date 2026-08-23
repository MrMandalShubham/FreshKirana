import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  BatchStatus,
  DEFAULT_MIN_SHELF_LIFE_PCT,
  byExpiryFirst,
  hasEnoughShelfLife,
  isPickable,
} from '@freshkirana/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { offerBatch, vendorOffer } from '../schema';

export interface BatchView {
  id: string;
  vendorOfferId: string;
  batchNo: string;
  mfgDate: Date | null;
  expiryDate: Date | null;
  receivedQuantity: number;
  remainingQuantity: number;
  status: string;
  /** Days left today. Null when the batch has no expiry at all. */
  daysLeft: number | null;
}

/**
 * Lots, and which one to sell (spec §1.7.3).
 *
 * A store holds the crate from Monday and the crate from Thursday. FEFO says
 * sell Monday's first — the oldest stock is sold first or it becomes waste,
 * which is the single largest controllable cost in fresh grocery.
 *
 * The other two jobs follow from the same rows: refusing to deliver something
 * about to go off, and answering "who received this lot?" when it turns out to
 * be unsafe.
 */
@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records a delivery into the store.
   *
   * Idempotent on the lot code: the same batch arriving twice is the same lot,
   * and two rows for it would split a recall in half — half the customers
   * found, half missed, and no way to tell from the inside.
   */
  async receive(input: {
    vendorOfferId: string;
    batchNo: string;
    quantity: number;
    mfgDate?: string | null;
    expiryDate?: string | null;
  }): Promise<BatchView> {
    const rows = await this.db
      .insert(offerBatch)
      .values({
        vendorOfferId: input.vendorOfferId,
        batchNo: input.batchNo,
        receivedQuantity: input.quantity,
        remainingQuantity: input.quantity,
        mfgDate: input.mfgDate ?? null,
        expiryDate: input.expiryDate ?? null,
        status: BatchStatus.ACTIVE,
      })
      .onConflictDoUpdate({
        target: [offerBatch.vendorOfferId, offerBatch.batchNo],
        set: {
          receivedQuantity: sql`${offerBatch.receivedQuantity} + ${input.quantity}`,
          remainingQuantity: sql`${offerBatch.remainingQuantity} + ${input.quantity}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return this.render(rows[0]!);
  }

  /**
   * The lots for an offer, oldest first (§1.7.3).
   *
   * This *is* the picking order. A picker handed a list in arrival order will
   * take whatever is nearest, and the shop discovers the cost weeks later as
   * waste it cannot attribute to anything.
   */
  async forOffer(vendorOfferId: string, pickableOnly = false): Promise<BatchView[]> {
    const rows = await this.db
      .select()
      .from(offerBatch)
      .where(eq(offerBatch.vendorOfferId, vendorOfferId));

    const views = rows
      .map((row) => this.render(row))
      .filter((batch) => !pickableOnly || isPickable(batch.status));

    return byExpiryFirst(views);
  }

  /** What a picker should take next, or null when there is nothing sellable. */
  async nextToPick(vendorOfferId: string): Promise<BatchView | null> {
    const pickable = await this.forOffer(vendorOfferId, true);
    return pickable.find((batch) => batch.remainingQuantity > 0) ?? null;
  }

  async byId(batchId: string): Promise<BatchView | null> {
    const rows = await this.db
      .select()
      .from(offerBatch)
      .where(eq(offerBatch.id, batchId))
      .limit(1);

    return rows[0] ? this.render(rows[0]) : null;
  }

  /**
   * Delists stock too short-dated to deliver (§1.7.3).
   *
   * Run on a schedule, because shelf life passes with the clock rather than
   * with anything a person does — a batch that was fine last night is not fine
   * this morning, and nobody logs in to notice.
   *
   * Delisting a batch does not delist the offer. A store with a fresh crate and
   * a stale one should keep selling; the offer only goes unavailable when
   * nothing sellable is left, which is checked below.
   */
  async delistShortDated(
    minPct: number = DEFAULT_MIN_SHELF_LIFE_PCT,
    now = new Date(),
  ): Promise<{ considered: number; delisted: number; offersClosed: number }> {
    const active = await this.db
      .select()
      .from(offerBatch)
      .where(
        and(
          eq(offerBatch.status, BatchStatus.ACTIVE),
          sql`${offerBatch.expiryDate} is not null`,
        ),
      )
      .orderBy(offerBatch.expiryDate)
      .limit(500);

    const doomed = active.filter(
      (row) =>
        !hasEnoughShelfLife(
          {
            mfgDate: row.mfgDate ? new Date(row.mfgDate) : null,
            expiryDate: new Date(row.expiryDate!),
          },
          now,
          minPct,
        ),
    );

    if (doomed.length === 0) {
      return { considered: active.length, delisted: 0, offersClosed: 0 };
    }

    await this.db
      .update(offerBatch)
      .set({ status: BatchStatus.DELISTED, updatedAt: new Date() })
      .where(
        inArray(
          offerBatch.id,
          doomed.map((row) => row.id),
        ),
      );

    const offersClosed = await this.closeOffersWithNothingSellable([
      ...new Set(doomed.map((row) => row.vendorOfferId)),
    ]);

    return { considered: active.length, delisted: doomed.length, offersClosed };
  }

  /**
   * Withdraws a lot on safety grounds (§1.7.3).
   *
   * Blocking further sale is the *first* thing that happens, before anyone is
   * notified and before any report is produced: every minute a recalled batch
   * stays sellable is another customer receiving it.
   */
  async recallBatches(batchIds: readonly string[]): Promise<number> {
    if (batchIds.length === 0) return 0;

    const recalled = await this.db
      .update(offerBatch)
      .set({ status: BatchStatus.RECALLED, updatedAt: new Date() })
      .where(inArray(offerBatch.id, [...batchIds]))
      .returning({ vendorOfferId: offerBatch.vendorOfferId });

    await this.closeOffersWithNothingSellable([
      ...new Set(recalled.map((row) => row.vendorOfferId)),
    ]);

    return recalled.length;
  }

  /**
   * Every lot of a master product carrying a given batch code.
   *
   * A recall names a manufacturer's lot, and that lot is sitting in however
   * many shops bought it — so this searches across stores rather than within
   * one. Finding it in four shops and stopping at the first is how a recall
   * misses people.
   */
  async findByBatchNo(masterProductId: string, batchNo: string): Promise<BatchView[]> {
    const rows = await this.db
      .select({ batch: offerBatch })
      .from(offerBatch)
      .innerJoin(vendorOffer, eq(offerBatch.vendorOfferId, vendorOffer.id))
      .where(
        and(
          eq(vendorOffer.masterProductId, masterProductId),
          eq(offerBatch.batchNo, batchNo),
        ),
      );

    return rows.map((row) => this.render(row.batch));
  }

  /** Takes stock off a lot as it is picked. */
  async consume(batchId: string, quantity: number): Promise<void> {
    const moved = await this.db
      .update(offerBatch)
      .set({
        remainingQuantity: sql`${offerBatch.remainingQuantity} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(offerBatch.id, batchId),
          eq(offerBatch.status, BatchStatus.ACTIVE),
          sql`${offerBatch.remainingQuantity} >= ${quantity}`,
        ),
      )
      .returning({ remaining: offerBatch.remainingQuantity });

    if (moved.length === 0) {
      throw new ConflictException({
        message: 'That batch cannot supply this line',
        code: 'BATCH_UNAVAILABLE',
      });
    }

    if (moved[0]!.remaining === 0) {
      await this.db
        .update(offerBatch)
        .set({ status: BatchStatus.DEPLETED, updatedAt: new Date() })
        .where(eq(offerBatch.id, batchId));
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Makes an offer unavailable once no lot can supply it.
   *
   * The offer's own `stock_on_hand` is left alone — P3.1 owns that number and
   * guards it atomically. This flips availability instead, which is the flag
   * search and checkout already read.
   */
  private async closeOffersWithNothingSellable(
    vendorOfferIds: readonly string[],
  ): Promise<number> {
    let closed = 0;

    for (const vendorOfferId of vendorOfferIds) {
      const sellable = await this.nextToPick(vendorOfferId);
      if (sellable) continue;

      await this.db
        .update(vendorOffer)
        .set({ isAvailable: false, updatedAt: new Date() })
        .where(eq(vendorOffer.id, vendorOfferId));

      closed += 1;
      this.logger.warn(`Offer ${vendorOfferId} has no sellable batch left`);
    }

    return closed;
  }

  private render(row: {
    id: string;
    vendorOfferId: string;
    batchNo: string;
    mfgDate: string | null;
    expiryDate: string | null;
    receivedQuantity: number;
    remainingQuantity: number;
    status: string;
  }): BatchView {
    const expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;

    return {
      id: row.id,
      vendorOfferId: row.vendorOfferId,
      batchNo: row.batchNo,
      mfgDate: row.mfgDate ? new Date(row.mfgDate) : null,
      expiryDate,
      receivedQuantity: row.receivedQuantity,
      remainingQuantity: row.remainingQuantity,
      status: row.status,
      daysLeft: expiryDate
        ? Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000)
        : null,
    };
  }
}
