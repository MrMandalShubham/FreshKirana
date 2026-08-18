import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Audience,
  type OrderStatus,
  type OrderTransition,
  type Role,
  TransitionEffect,
  TransitionGuard,
  allowedTransitions,
  findTransition,
  labelFor,
  nextStatuses,
} from '@freshkirana/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database, Transaction } from '../../../db';
import { SlotService } from '../../serviceability/contracts';
import { order, orderStatusHistory } from '../schema';

export interface TransitionActor {
  accountId: string | null;
  role: Role;
}

export interface TransitionOptions {
  reason?: string;
  /** Restricts the move to an order of this vendor. Vendor-scoped routes set it. */
  vendorId?: string;
  /** Restricts the move to this account's own order. Customer routes set it. */
  accountId?: string;
}

/**
 * Executes the §2.6 transition table.
 *
 * Nothing else in the codebase writes `order.status`. §2.6 requires that: a
 * status set directly is a status set without a guard, without an audit row and
 * without the effects that were supposed to accompany it — and the one that
 * matters here is releasing the delivery slot, which is invisible until a store
 * runs out of capacity it never actually used.
 */
@Injectable()
export class OrderStateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly slots: SlotService,
  ) {}

  /**
   * Moves an order to `to`, or explains why it cannot.
   *
   * The failures are deliberately distinct: 404 when the order is not yours,
   * 403 when your role may never make this move, 409 when the move is illegal
   * from here or somebody else got there first. A client that cannot tell those
   * apart cannot decide whether to hide a button, show an error, or refresh.
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    actor: TransitionActor,
    options: TransitionOptions = {},
  ) {
    const current = await this.load(orderId, options);
    const from = current.status as OrderStatus;

    const transition = findTransition(from, to);
    if (!transition) {
      throw new ConflictException({
        message: `An order cannot go from ${from} to ${to}`,
        code: 'ILLEGAL_TRANSITION',
        from,
        to,
        allowed: nextStatuses(from),
      });
    }

    if (!transition.actors.includes(actor.role)) {
      throw new ForbiddenException({
        message: `A ${actor.role} may not move an order from ${from} to ${to}`,
        code: 'TRANSITION_NOT_PERMITTED',
        from,
        to,
        allowed: allowedTransitions(from, actor.role).map((t) => t.to),
      });
    }

    this.assertGuards(transition, options);

    return this.db.transaction(async (tx) => {
      // Conditional on the status we read. Two people acting on the same order
      // at once — a store accepting while ops reassigns — must not both apply;
      // whoever is second is told the order moved rather than silently winning.
      const moved = await tx
        .update(order)
        .set({ status: to, updatedAt: new Date() })
        .where(and(eq(order.id, orderId), eq(order.status, from)))
        .returning();

      const updated = moved[0];
      if (!updated) {
        throw new ConflictException({
          message:
            'This order changed while you were looking at it. Reload and try again.',
          code: 'TRANSITION_RACE_LOST',
          expectedFrom: from,
        });
      }

      await tx.insert(orderStatusHistory).values({
        orderId,
        fromStatus: from,
        toStatus: to,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        reason: options.reason ?? null,
      });

      await this.applyEffects(transition, updated, tx);

      return { order: updated, transition };
    });
  }

  /** The audit trail: how this order reached where it is (§3.8). */
  async history(orderId: string) {
    return this.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt));
  }

  /**
   * What this role may do to this order next.
   *
   * Returned to the surfaces so a button exists only where the move is legal —
   * the alternative is rendering every button and letting the server say no,
   * which teaches people that the app is broken.
   */
  nextFor(status: OrderStatus, role: Role) {
    return allowedTransitions(status, role).map((transition) => ({
      to: transition.to,
      requiresReason: (transition.guards ?? []).includes(TransitionGuard.REASON_REQUIRED),
      note: transition.note,
    }));
  }

  /** The §2.6.3 label for one audience. One state, many vocabularies. */
  label(status: OrderStatus, audience: Audience): string | null {
    return labelFor(status, audience);
  }

  // -------------------------------------------------------------------------

  private assertGuards(transition: OrderTransition, options: TransitionOptions): void {
    for (const guard of transition.guards ?? []) {
      switch (guard) {
        case TransitionGuard.REASON_REQUIRED:
          if (!options.reason?.trim()) {
            throw new BadRequestException({
              message: 'This change needs a reason',
              code: 'REASON_REQUIRED',
            });
          }
          break;

        case TransitionGuard.CUSTOMER_CANCEL_WINDOW:
          // The window *is* the table: §1.8.1 says a customer may cancel up to
          // and including PACKED, and there is simply no CANCELLED row from
          // DISPATCHED onward. Reaching this guard means the row exists, so the
          // order is inside the window by construction. Kept as a named guard
          // because §1.8.1 also allows a cancellation fee from PACKED, and that
          // rule will need somewhere to live (P3.5).
          break;
      }
    }
  }

  private async applyEffects(
    transition: OrderTransition,
    updated: { slotInstanceId: string },
    tx: Transaction,
  ): Promise<void> {
    for (const effect of transition.effects ?? []) {
      switch (effect) {
        case TransitionEffect.RELEASE_SLOT:
          // In the same transaction as the status change: a cancelled order
          // still holding a place is capacity the store cannot sell and a
          // shopper cannot book, and nothing would ever notice.
          await this.slots.release(updated.slotInstanceId, tx);
          break;
      }
    }
  }

  private async load(orderId: string, options: TransitionOptions) {
    const filters = [eq(order.id, orderId)];
    if (options.vendorId) filters.push(eq(order.vendorId, options.vendorId));
    if (options.accountId) filters.push(eq(order.accountId, options.accountId));

    const rows = await this.db
      .select()
      .from(order)
      .where(and(...filters))
      .limit(1);

    const found = rows[0];
    // Scoped: another store's or another customer's order is *not found*, never
    // forbidden, so the response cannot confirm that it exists.
    if (!found) throw new NotFoundException(`Order ${orderId} not found`);
    return found;
  }
}
