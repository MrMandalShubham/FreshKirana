import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_RESERVATION_STATUSES,
  ReservationOutcome,
  ReservationStatus,
  modeReserves,
  reservationExpiresAt,
} from '@freshkirana/contracts';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { OfferService } from '../../offer/contracts';
import { reservation } from '../schema';

export interface ReserveInput {
  vendorOfferId: string;
  quantity: number;
  /** Rule R4. The same key must never take stock twice. */
  idempotencyKey: string;
  orderId?: string | null;
  accountId?: string | null;
  ttlMinutes: number;
}

export interface ReserveResult {
  outcome: ReservationOutcome;
  reservationId: string | null;
  /** How much was actually held. Zero when the mode does not reserve. */
  quantity: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly offers: OfferService,
  ) {}

  /**
   * Holds stock for a checkout (spec §2.5).
   *
   * Three answers, and only one of them is a refusal:
   *
   * - **RESERVED** — the stock is held.
   * - **MODE_DOES_NOT_RESERVE** — the shop keeps no counts (§1.9.2). Not a
   *   failure: that tier exists so a kirana can trade before it maintains true
   *   inventory, and refusing would exclude most shops on day one.
   * - **INSUFFICIENT_STOCK** — somebody else got there first.
   *
   * Idempotent by the unique key, not by a check-then-insert: two concurrent
   * retries of the same request would both pass a check, and one of them would
   * take a second unit.
   */
  async reserve(
    input: ReserveInput,
    tx: Transaction | Database = this.db,
  ): Promise<ReserveResult> {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey, tx);
    if (existing) {
      return {
        outcome: ReservationOutcome.ALREADY_RESERVED,
        reservationId: existing.id,
        quantity: existing.quantity,
      };
    }

    const offer = await this.offers.findById(input.vendorOfferId);
    if (!offer) {
      return {
        outcome: ReservationOutcome.INSUFFICIENT_STOCK,
        reservationId: null,
        quantity: 0,
      };
    }

    if (!modeReserves(offer.inventoryMode)) {
      return {
        outcome: ReservationOutcome.MODE_DOES_NOT_RESERVE,
        reservationId: null,
        quantity: 0,
      };
    }

    // The guarded decrement. Nothing is read first, so there is no window for
    // a second checkout to take the same unit — see OfferService.takeStock.
    const taken = await this.offers.takeStock(input.vendorOfferId, input.quantity, tx);
    if (!taken) {
      return {
        outcome: ReservationOutcome.INSUFFICIENT_STOCK,
        reservationId: null,
        quantity: 0,
      };
    }

    const rows = await tx
      .insert(reservation)
      .values({
        vendorOfferId: input.vendorOfferId,
        orderId: input.orderId ?? null,
        accountId: input.accountId ?? null,
        quantity: input.quantity,
        status: ReservationStatus.HELD,
        idempotencyKey: input.idempotencyKey,
        expiresAt: reservationExpiresAt(new Date(), input.ttlMinutes),
      })
      .returning();

    return {
      outcome: ReservationOutcome.RESERVED,
      reservationId: rows[0]!.id,
      quantity: input.quantity,
    };
  }

  /**
   * The money is settled; the hold stops expiring.
   *
   * Clearing `expiresAt` rather than pushing it far into the future, so the
   * sweeper needs no knowledge of status precedence — anything with an expiry
   * in the past is expired, and a confirmed hold has none.
   */
  async confirmForOrder(orderId: string, tx: Transaction | Database = this.db) {
    return tx
      .update(reservation)
      .set({
        status: ReservationStatus.CONFIRMED,
        expiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservation.orderId, orderId),
          eq(reservation.status, ReservationStatus.HELD),
        ),
      )
      .returning();
  }

  /**
   * Gives every hold on an order back.
   *
   * Conditional on the reservation still being active, so a double
   * cancellation — support and a customer at once — returns the stock once.
   * Without that guard the shop's count creeps upward every time.
   */
  async releaseForOrder(
    orderId: string,
    reason: string,
    tx: Transaction | Database = this.db,
  ): Promise<number> {
    const released = await tx
      .update(reservation)
      .set({
        status: ReservationStatus.RELEASED,
        releasedReason: reason,
        expiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservation.orderId, orderId),
          inArray(reservation.status, [...ACTIVE_RESERVATION_STATUSES]),
        ),
      )
      .returning();

    for (const row of released) {
      await this.offers.giveBackStock(row.vendorOfferId, row.quantity, tx);
    }

    return released.length;
  }

  /** The order was packed: the stock has left the shelf, not just the hold. */
  async consumeForOrder(orderId: string, tx: Transaction | Database = this.db) {
    const consumed = await tx
      .update(reservation)
      .set({ status: ReservationStatus.CONSUMED, updatedAt: new Date() })
      .where(
        and(
          eq(reservation.orderId, orderId),
          inArray(reservation.status, [...ACTIVE_RESERVATION_STATUSES]),
        ),
      )
      .returning();

    for (const row of consumed) {
      await this.offers.consumeStock(row.vendorOfferId, row.quantity, tx);
    }

    return consumed.length;
  }

  /**
   * Releases holds nobody confirmed (§2.5).
   *
   * Runs every minute from a Cloud Run job. Abandoned checkouts are the normal
   * case, not an exception — somebody opens a payment app and never comes
   * back — and without this the stock they were holding is unsellable until a
   * human notices.
   *
   * One order at a time, so one bad row cannot strand the rest: a sweeper that
   * stops halfway is the failure a sweeper exists to prevent.
   */
  async sweepExpired(now = new Date(), limit = 500) {
    const expired = await this.db
      .select()
      .from(reservation)
      .where(
        and(
          eq(reservation.status, ReservationStatus.HELD),
          lte(reservation.expiresAt, now),
        ),
      )
      .orderBy(asc(reservation.expiresAt))
      .limit(limit);

    let released = 0;
    let failed = 0;

    for (const row of expired) {
      try {
        await this.db.transaction(async (tx) => {
          // Conditional on it still being HELD: a checkout that confirmed
          // between the read above and now must not have its stock taken away.
          const claimed = await tx
            .update(reservation)
            .set({
              status: ReservationStatus.RELEASED,
              releasedReason: 'Expired before confirmation',
              expiresAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(reservation.id, row.id),
                eq(reservation.status, ReservationStatus.HELD),
              ),
            )
            .returning();

          if (claimed.length === 0) return;

          await this.offers.giveBackStock(row.vendorOfferId, row.quantity, tx);
          released += 1;
        });
      } catch (error) {
        failed += 1;
        this.logger.error(`Could not release reservation ${row.id}: ${String(error)}`);
      }
    }

    return { considered: expired.length, released, failed };
  }

  /** What is held against an order. For support, and for the vendor's view. */
  async forOrder(orderId: string) {
    return this.db
      .select()
      .from(reservation)
      .where(eq(reservation.orderId, orderId))
      .orderBy(asc(reservation.createdAt));
  }

  /**
   * The counter and the ledger, side by side.
   *
   * `stock_reserved` is a number that can drift; these rows are what it should
   * have been. A mismatch is worth knowing about before a picker finds it.
   */
  async heldFor(vendorOfferId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${reservation.quantity}), 0)::int` })
      .from(reservation)
      .where(
        and(
          eq(reservation.vendorOfferId, vendorOfferId),
          inArray(reservation.status, [...ACTIVE_RESERVATION_STATUSES]),
        ),
      );

    return Number(rows[0]?.total ?? 0);
  }

  private async findByIdempotencyKey(key: string, tx: Transaction | Database) {
    const rows = await tx
      .select()
      .from(reservation)
      .where(eq(reservation.idempotencyKey, key))
      .limit(1);

    return rows[0] ?? null;
  }
}
