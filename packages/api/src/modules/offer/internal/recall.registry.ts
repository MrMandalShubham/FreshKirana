import { Inject, Injectable } from '@nestjs/common';
import { RecallStatus, type RecallReason } from '@freshkirana/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { recall } from '../schema';

/**
 * The recall record (spec §1.7.3).
 *
 * Lives in the offer module because it owns the `offer` schema, and does no
 * orchestration: finding affected customers and telling them needs orders, and
 * this module knows nothing about those. The order module drives it.
 */
@Injectable()
export class RecallRegistry {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Opens one, or returns the open one.
   *
   * Idempotent on the lot, because raising the same recall twice would notify
   * the same customers twice and produce two reports that disagree — and the
   * second is exactly what somebody does when the first appears not to have
   * worked.
   */
  async open(input: {
    masterProductId: string;
    batchNo: string;
    reason: RecallReason;
    raisedBy: string;
    note: string | null;
    batchesAffected: number;
  }) {
    const existing = await this.db
      .select()
      .from(recall)
      .where(
        and(
          eq(recall.masterProductId, input.masterProductId),
          eq(recall.batchNo, input.batchNo),
        ),
      )
      .limit(1);

    const open = existing.find((row) => row.status !== RecallStatus.CLOSED);
    if (open) return open;

    const rows = await this.db
      .insert(recall)
      .values({
        masterProductId: input.masterProductId,
        batchNo: input.batchNo,
        reason: input.reason,
        raisedBy: input.raisedBy,
        note: input.note,
        status: RecallStatus.OPEN,
        batchesAffected: input.batchesAffected,
      })
      .returning();

    return rows[0]!;
  }

  async byId(recallId: string) {
    const rows = await this.db
      .select()
      .from(recall)
      .where(eq(recall.id, recallId))
      .limit(1);

    return rows[0] ?? null;
  }

  async markNotified(
    recallId: string,
    counts: { ordersAffected: number; customersNotified: number },
  ): Promise<void> {
    await this.db
      .update(recall)
      .set({
        status: RecallStatus.NOTIFIED,
        ordersAffected: counts.ordersAffected,
        customersNotified: counts.customersNotified,
        notifiedAt: new Date(),
      })
      .where(eq(recall.id, recallId));
  }

  async close(recallId: string): Promise<void> {
    await this.db
      .update(recall)
      .set({ status: RecallStatus.CLOSED, closedAt: new Date() })
      .where(eq(recall.id, recallId));
  }

  async list(status?: RecallStatus) {
    const query = this.db.select().from(recall).orderBy(desc(recall.raisedAt)).limit(100);
    return status ? query.where(eq(recall.status, status)) : query;
  }
}
