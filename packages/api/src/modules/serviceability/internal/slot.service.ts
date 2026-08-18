import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_CUTOFF_MINUTES_BEFORE,
  type SlotStatus,
  StoredSlotStatus,
  effectiveSlotStatus,
  formatMinuteOfDay,
  istDayOfWeek,
  istInstant,
  slotCapacity,
  upcomingDateKeys,
} from '@freshkirana/contracts';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { VendorService } from '../../vendor/contracts';
import { slotDefinition, slotInstance } from '../schema';

export interface SlotDefinitionInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  pickingCapacityOrders: number;
  deliveryCapacityOrders: number;
  cutoffMinutesBefore?: number;
  isActive?: boolean;
}

export interface SlotView {
  id: string;
  vendorId: string;
  serviceDate: string;
  startsAt: Date;
  endsAt: Date;
  /** `10:00 – 12:00`, ready to render. */
  label: string;
  capacity: number;
  booked: number;
  remaining: number;
  status: SlotStatus;
  isBookable: boolean;
  cutoffAt: Date;
}

/** How far ahead a shopper may book. Beyond a week nobody knows their plans. */
const DEFAULT_HORIZON_DAYS = 3;
const MAX_HORIZON_DAYS = 7;

@Injectable()
export class SlotService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vendors: VendorService,
  ) {}

  // -------------------------------------------------------------------------
  // Definitions — the store's weekly pattern
  // -------------------------------------------------------------------------

  async defineSlot(vendorId: string, input: SlotDefinitionInput) {
    await this.vendors.findById(vendorId);

    const values = {
      vendorId,
      dayOfWeek: input.dayOfWeek,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      pickingCapacityOrders: input.pickingCapacityOrders,
      deliveryCapacityOrders: input.deliveryCapacityOrders,
      cutoffMinutesBefore: input.cutoffMinutesBefore ?? DEFAULT_CUTOFF_MINUTES_BEFORE,
      isActive: input.isActive ?? true,
    };

    // Re-defining the same window updates it rather than colliding: a vendor
    // editing "Tuesday 10–12" means that one, not a new one.
    const rows = await this.db
      .insert(slotDefinition)
      .values(values)
      .onConflictDoUpdate({
        target: [
          slotDefinition.vendorId,
          slotDefinition.dayOfWeek,
          slotDefinition.startMinute,
        ],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();

    return rows[0]!;
  }

  async listDefinitions(vendorId: string) {
    return this.db
      .select()
      .from(slotDefinition)
      .where(eq(slotDefinition.vendorId, vendorId))
      .orderBy(asc(slotDefinition.dayOfWeek), asc(slotDefinition.startMinute));
  }

  async removeDefinition(vendorId: string, definitionId: string): Promise<void> {
    const rows = await this.db
      .delete(slotDefinition)
      .where(
        and(eq(slotDefinition.id, definitionId), eq(slotDefinition.vendorId, vendorId)),
      )
      .returning({ id: slotDefinition.id });

    if (rows.length === 0)
      throw new NotFoundException(`Slot definition ${definitionId} not found`);
  }

  // -------------------------------------------------------------------------
  // Instances — the dated slots a shopper books
  // -------------------------------------------------------------------------

  /**
   * The slots a store is offering over the next few days.
   *
   * Materialises the instances on the way through. A nightly job would be one
   * more scheduler to run, monitor and back-fill after every outage; generating
   * on demand means a slot exists exactly when somebody looks for it, and the
   * unique key on (definition, date) makes two concurrent readers harmless.
   */
  async listSlots(
    vendorId: string,
    options: { days?: number; now?: Date } = {},
  ): Promise<SlotView[]> {
    const now = options.now ?? new Date();
    const days = Math.min(options.days ?? DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS);
    const dateKeys = upcomingDateKeys(now, days);

    await this.materialise(vendorId, dateKeys);

    const rows = await this.db
      .select()
      .from(slotInstance)
      .where(
        and(
          eq(slotInstance.vendorId, vendorId),
          inArray(slotInstance.serviceDate, dateKeys),
          // Today's slots that have already ended are noise, not information.
          gte(slotInstance.endsAt, now),
        ),
      )
      .orderBy(asc(slotInstance.startsAt));

    return rows.map((row) => this.toView(row, now));
  }

  async findSlot(slotInstanceId: string, now = new Date()): Promise<SlotView> {
    const rows = await this.db
      .select()
      .from(slotInstance)
      .where(eq(slotInstance.id, slotInstanceId))
      .limit(1);

    const found = rows[0];
    if (!found) throw new NotFoundException(`Slot ${slotInstanceId} not found`);
    return this.toView(found, now);
  }

  /**
   * Takes one place in a slot.
   *
   * ## Why this is a single statement
   *
   * The whole condition — open, not full, before cutoff — lives in the `WHERE`
   * clause, so the check and the decrement cannot be separated by another
   * transaction. Reading the slot, deciding, then updating would leave a window
   * in which two checkouts both see the last place and both take it, and the
   * §2.8.2 promise of "never a silent failure at checkout" would be exactly
   * what breaks: two shoppers told yes, one order the store cannot pack.
   *
   * Checkout (P2.3) calls this inside its own transaction, alongside the stock
   * reservation, so a failure either side releases both.
   */
  async book(slotInstanceId: string): Promise<SlotView> {
    const rows = await this.db
      .update(slotInstance)
      .set({ booked: sql`${slotInstance.booked} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(slotInstance.id, slotInstanceId),
          eq(slotInstance.status, StoredSlotStatus.OPEN),
          sql`${slotInstance.booked} < ${slotInstance.capacity}`,
          sql`now() < ${slotInstance.startsAt} - make_interval(mins => ${slotInstance.cutoffMinutesBefore})`,
        ),
      )
      .returning();

    const booked = rows[0];
    if (booked) return this.toView(booked, new Date());

    // Nothing was updated. Say *which* of the reasons it was — "slot
    // unavailable" leaves the shopper to guess whether to wait or pick another
    // day, and the three answers point in different directions.
    throw await this.explainBookingFailure(slotInstanceId);
  }

  /**
   * Gives a place back, when an order fails or is cancelled before the slot.
   *
   * `greatest(0, ...)` because a double release must not push the count
   * negative: an under-counted slot oversells, which is the failure this whole
   * model exists to prevent.
   */
  async release(slotInstanceId: string): Promise<SlotView> {
    const rows = await this.db
      .update(slotInstance)
      .set({
        booked: sql`greatest(0, ${slotInstance.booked} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(slotInstance.id, slotInstanceId))
      .returning();

    const released = rows[0];
    if (!released) throw new NotFoundException(`Slot ${slotInstanceId} not found`);
    return this.toView(released, new Date());
  }

  /** Vendor holiday, festival, or an ops-declared closure (§2.8.2). */
  async setStatus(
    vendorId: string,
    slotInstanceId: string,
    status: StoredSlotStatus,
  ): Promise<SlotView> {
    const rows = await this.db
      .update(slotInstance)
      .set({ status, updatedAt: new Date() })
      .where(
        and(eq(slotInstance.id, slotInstanceId), eq(slotInstance.vendorId, vendorId)),
      )
      .returning();

    const updated = rows[0];
    if (!updated) throw new NotFoundException(`Slot ${slotInstanceId} not found`);
    return this.toView(updated, new Date());
  }

  // -------------------------------------------------------------------------

  /**
   * Creates the missing slot instances for these dates.
   *
   * Capacity is frozen into the instance at this point, deliberately: raising a
   * definition's capacity should not silently change a day people have already
   * booked into, and lowering it must never strand orders that already exist.
   */
  private async materialise(vendorId: string, dateKeys: string[]): Promise<void> {
    const definitions = await this.db
      .select()
      .from(slotDefinition)
      .where(
        and(eq(slotDefinition.vendorId, vendorId), eq(slotDefinition.isActive, true)),
      );

    if (definitions.length === 0) return;

    const values = [];
    for (const dateKey of dateKeys) {
      const dayOfWeek = istDayOfWeek(dateKey);
      for (const definition of definitions) {
        if (definition.dayOfWeek !== dayOfWeek) continue;

        values.push({
          vendorId,
          slotDefinitionId: definition.id,
          serviceDate: dateKey,
          startsAt: istInstant(dateKey, definition.startMinute),
          endsAt: istInstant(dateKey, definition.endMinute),
          capacity: slotCapacity(definition),
          cutoffMinutesBefore: definition.cutoffMinutesBefore,
        });
      }
    }

    if (values.length === 0) return;

    await this.db
      .insert(slotInstance)
      .values(values)
      .onConflictDoNothing({
        target: [slotInstance.slotDefinitionId, slotInstance.serviceDate],
      });
  }

  private toView(
    row: {
      id: string;
      vendorId: string;
      serviceDate: string;
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      booked: number;
      cutoffMinutesBefore: number;
      status: string;
    },
    now: Date,
  ): SlotView {
    const state = {
      startsAt: row.startsAt,
      cutoffMinutesBefore: row.cutoffMinutesBefore,
      capacity: row.capacity,
      booked: row.booked,
      storedStatus: row.status as StoredSlotStatus,
    };

    const status = effectiveSlotStatus(state, now);

    return {
      id: row.id,
      vendorId: row.vendorId,
      serviceDate: row.serviceDate,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      label: `${formatMinuteOfDay(this.minuteOfDay(row.startsAt))} – ${formatMinuteOfDay(
        this.minuteOfDay(row.endsAt),
      )}`,
      capacity: row.capacity,
      booked: row.booked,
      remaining: Math.max(0, row.capacity - row.booked),
      status,
      isBookable: status === 'OPEN',
      cutoffAt: new Date(row.startsAt.getTime() - row.cutoffMinutesBefore * 60_000),
    };
  }

  /** Minutes from midnight IST, for the display label. */
  private minuteOfDay(instant: Date): number {
    const shifted = new Date(instant.getTime() + 330 * 60_000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }

  private async explainBookingFailure(slotInstanceId: string): Promise<Error> {
    const slot = await this.findSlot(slotInstanceId).catch(() => null);
    if (!slot) return new NotFoundException(`Slot ${slotInstanceId} not found`);

    switch (slot.status) {
      case 'FULL':
        return new ConflictException({
          message:
            'That slot is fully booked. Pick another and your basket stays as it is.',
          code: 'SLOT_FULL',
          slotInstanceId,
        });
      case 'BLACKOUT':
        return new ConflictException({
          message: 'The store is closed for that slot.',
          code: 'SLOT_BLACKOUT',
          slotInstanceId,
        });
      default:
        return new ConflictException({
          message: 'That slot has closed for orders. Its cutoff has passed.',
          code: 'SLOT_CLOSED',
          slotInstanceId,
          cutoffAt: slot.cutoffAt,
        });
    }
  }
}
