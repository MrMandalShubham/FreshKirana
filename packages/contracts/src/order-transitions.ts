/**
 * The order state machine, as a single declarative table (spec §2.6).
 *
 * ## Why a table and not code
 *
 * §2.6 is explicit: "no transition may be triggered by an ad-hoc status write".
 * Scattering `order.status = 'PACKED'` across services is how a system ends up
 * with two vocabularies and states nobody can reach — which is the mistake v1.0
 * of the spec made. Here every legal move is one row, and anything absent from
 * the table is illegal by construction rather than by somebody remembering.
 *
 * Guards and effects are **named**, not functions. This package is shared with
 * the frontends and must stay free of database and service dependencies; the
 * order module resolves each name to behaviour. The names are also what makes
 * the table readable as a specification.
 */

import { AnalyticsEvent } from './analytics';
import { OrderStatus } from './order-status';
import { Role } from './roles';

/**
 * A condition that must hold before a transition is allowed.
 *
 * Distinct from role: role answers "may you do this at all", a guard answers
 * "may it be done right now, to this order".
 */
export const TransitionGuard = {
  /** §1.8.1: the customer may cancel up to and including PACKED, not after. */
  CUSTOMER_CANCEL_WINDOW: 'CUSTOMER_CANCEL_WINDOW',
  /** A cancellation or rejection must say why — it feeds the §6.4 vendor score. */
  REASON_REQUIRED: 'REASON_REQUIRED',
} as const;

export type TransitionGuard = (typeof TransitionGuard)[keyof typeof TransitionGuard];

/**
 * Something that must happen alongside the status change, in the same
 * transaction.
 *
 * Only effects that exist today are listed. Notifications (P8.3) and ledger
 * postings (P5.3) attach here as they land — the point of naming them is that a
 * new effect is a row in this table, not a new call site somewhere in a service.
 */
export const TransitionEffect = {
  /** Give the delivery slot's place back, so somebody else can book it. */
  RELEASE_SLOT: 'RELEASE_SLOT',
  /** Put the held stock back on the shelf (§2.5). */
  RELEASE_STOCK: 'RELEASE_STOCK',
  /** The stock left the building: no longer held, no longer on hand. */
  CONSUME_STOCK: 'CONSUME_STOCK',
} as const;

export type TransitionEffect = (typeof TransitionEffect)[keyof typeof TransitionEffect];

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  /** Who may trigger it. ADMIN and OPS are added to every row — see below. */
  actors: readonly Role[];
  guards?: readonly TransitionGuard[];
  effects?: readonly TransitionEffect[];
  /** Emitted on success (rule R1). */
  event?: AnalyticsEvent;
  /** One line explaining why this move exists, for whoever reads the table. */
  note?: string;
}

/**
 * Ops can always intervene.
 *
 * Support exists because reality does not follow the diagram: a rider's phone
 * dies mid-delivery, a store marks the wrong order packed. Denying ops the
 * ability to correct state would guarantee an out-of-band `UPDATE` against the
 * database, which is worse — it leaves no audit trail at all (§3.8).
 */
const OPS: readonly Role[] = [Role.ADMIN, Role.OPS];

const VENDOR: readonly Role[] = [Role.VENDOR_OWNER, Role.VENDOR_STAFF];

const TRANSITIONS: readonly OrderTransition[] = [
  // --- Placement ----------------------------------------------------------
  {
    from: OrderStatus.PENDING_PAYMENT,
    to: OrderStatus.AWAITING_VENDOR,
    actors: [],
    note: 'Prepaid, once the gateway confirms (P3.2). COD skips this state.',
  },
  {
    from: OrderStatus.PENDING_PAYMENT,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
    note: 'Payment failed or timed out. No fee — nothing was ever charged.',
  },

  // --- The store decides --------------------------------------------------
  {
    from: OrderStatus.AWAITING_VENDOR,
    to: OrderStatus.ACCEPTED,
    actors: VENDOR,
    event: AnalyticsEvent.VENDOR_ACCEPTED,
    note: 'The store has the stock and will pack it.',
  },
  {
    from: OrderStatus.AWAITING_VENDOR,
    to: OrderStatus.REASSIGNING,
    actors: VENDOR,
    guards: [TransitionGuard.REASON_REQUIRED],
    note: 'Rejected, or the acceptance SLA lapsed. The reason feeds §6.4.',
  },
  {
    from: OrderStatus.AWAITING_VENDOR,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.CUSTOMER_CANCEL_WINDOW],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
    note: '§1.8.1: free, the store has not started work.',
  },

  // --- Reassignment -------------------------------------------------------
  {
    from: OrderStatus.REASSIGNING,
    to: OrderStatus.AWAITING_VENDOR,
    actors: [],
    note: 'Offered to another store. Automatic — no human triggers this.',
  },
  {
    from: OrderStatus.REASSIGNING,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.REASON_REQUIRED],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
    note: 'Nobody else can fulfil it.',
  },

  // --- Picking ------------------------------------------------------------
  {
    from: OrderStatus.ACCEPTED,
    to: OrderStatus.PICKING,
    actors: VENDOR,
    note: 'Somebody is walking the aisles with the list.',
  },
  {
    from: OrderStatus.ACCEPTED,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.CUSTOMER_CANCEL_WINDOW],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
    note: '§1.8.1: accepted but not packed — still free.',
  },
  {
    from: OrderStatus.PICKING,
    to: OrderStatus.SUBSTITUTION_PENDING,
    actors: VENDOR,
    event: AnalyticsEvent.SUBSTITUTION_PROPOSED,
    note: 'An item is out of stock and the customer chose ASK_ME (§1.7.2).',
  },
  {
    from: OrderStatus.SUBSTITUTION_PENDING,
    to: OrderStatus.PICKING,
    actors: [Role.CUSTOMER, ...VENDOR],
    note: 'The customer answered, or the wait expired into their default.',
  },
  {
    from: OrderStatus.PICKING,
    to: OrderStatus.PACKED,
    actors: VENDOR,
    effects: [TransitionEffect.CONSUME_STOCK],
    event: AnalyticsEvent.ORDER_PACKED,
    note: 'Bagged and weighed. The COD amount is final from here (§2.6.1). The stock leaves the shelf at this point, not at delivery.',
  },
  {
    from: OrderStatus.PICKING,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.CUSTOMER_CANCEL_WINDOW],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
  },

  // --- Handover -----------------------------------------------------------
  {
    from: OrderStatus.PACKED,
    to: OrderStatus.READY_FOR_PICKUP,
    actors: VENDOR,
    note: 'Waiting on the counter for a rider.',
  },
  {
    from: OrderStatus.PACKED,
    to: OrderStatus.CANCELLED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.CUSTOMER_CANCEL_WINDOW],
    effects: [TransitionEffect.RELEASE_SLOT, TransitionEffect.RELEASE_STOCK],
    event: AnalyticsEvent.ORDER_CANCELLED,
    note: '§1.8.1: allowed with a warning. The work is done and wasted.',
  },
  {
    from: OrderStatus.READY_FOR_PICKUP,
    to: OrderStatus.DISPATCHED,
    actors: [Role.RIDER, Role.FLEET_MANAGER, ...VENDOR],
    event: AnalyticsEvent.ORDER_DISPATCHED,
    note: 'In a rider’s hands and moving.',
  },
  {
    from: OrderStatus.READY_FOR_PICKUP,
    to: OrderStatus.COMPLETED,
    actors: VENDOR,
    note: 'Customer collected it from the store themselves (§2.6.1 pickup).',
  },

  // --- The door -----------------------------------------------------------
  {
    from: OrderStatus.DISPATCHED,
    to: OrderStatus.DELIVERED,
    actors: [Role.RIDER, Role.FLEET_MANAGER],
    event: AnalyticsEvent.ORDER_DELIVERED,
    note: 'Handed over. Proof of delivery is P6.2; COD collection is P3.4.',
  },
  {
    from: OrderStatus.DISPATCHED,
    to: OrderStatus.DELIVERY_FAILED,
    actors: [Role.RIDER, Role.FLEET_MANAGER],
    guards: [TransitionGuard.REASON_REQUIRED],
    event: AnalyticsEvent.DELIVERY_FAILED,
    note: 'Nobody home, address unreachable, refused, or no cash (§2.9.3).',
  },
  {
    from: OrderStatus.DELIVERY_FAILED,
    to: OrderStatus.DISPATCHED,
    actors: [Role.RIDER, Role.FLEET_MANAGER],
    note: 'The one retry §2.9.3 allows where it is feasible.',
  },
  {
    from: OrderStatus.DELIVERY_FAILED,
    to: OrderStatus.RTO,
    actors: [Role.RIDER, Role.FLEET_MANAGER],
    note: 'Going back to the store. Stock return and refund follow (§1.8).',
  },
  {
    from: OrderStatus.RTO,
    to: OrderStatus.RETURNED,
    actors: VENDOR,
    note: 'Back on the shelf. Restocking is P3.5, with the refund it belongs to.',
  },

  // --- After delivery -----------------------------------------------------
  {
    from: OrderStatus.DELIVERED,
    to: OrderStatus.COMPLETED,
    actors: [],
    note: 'Automatic once the return window closes.',
  },
  {
    from: OrderStatus.DELIVERED,
    to: OrderStatus.RETURN_REQUESTED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.REASON_REQUIRED],
    note: '§1.8.3.',
  },
  {
    from: OrderStatus.COMPLETED,
    to: OrderStatus.RETURN_REQUESTED,
    actors: [Role.CUSTOMER],
    guards: [TransitionGuard.REASON_REQUIRED],
    note: '§2.6.1: a completed order can still be returned.',
  },
  {
    from: OrderStatus.RETURN_REQUESTED,
    to: OrderStatus.RETURNED,
    actors: VENDOR,
    note: 'Collected and accepted. The refund is §1.8.2.',
  },
];

/**
 * The table, with ops added to every row.
 *
 * Done here rather than by hand on each row so it cannot be forgotten on the
 * one transition where support most needs it.
 */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = TRANSITIONS.map(
  (transition) => ({
    ...transition,
    actors: [...new Set([...transition.actors, ...OPS])],
  }),
);

export function findTransition(
  from: OrderStatus,
  to: OrderStatus,
): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/** Every state reachable from here, whoever is asking. */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

/** What *this* role may do next — the buttons a surface should render. */
export function allowedTransitions(from: OrderStatus, role: Role): OrderTransition[] {
  return ORDER_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.actors.includes(role),
  );
}

export function isTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
  role: Role,
): boolean {
  return allowedTransitions(from, role).some((transition) => transition.to === to);
}

// ---------------------------------------------------------------------------
// Role-specific labels (§2.6.3)
// ---------------------------------------------------------------------------

/**
 * One canonical state; each audience sees its own vocabulary.
 *
 * §2.6.3 is emphatic that these are *labels over* the canonical state and never
 * parallel state machines. Keeping them as a lookup — rather than a `status`
 * column per audience — is what stops them drifting into one.
 */
export const Audience = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  RIDER: 'RIDER',
} as const;

export type Audience = (typeof Audience)[keyof typeof Audience];

const LABELS: Record<OrderStatus, Record<Audience, string | null>> = {
  DRAFT: { CUSTOMER: 'Not placed', VENDOR: null, RIDER: null },
  PENDING_PAYMENT: { CUSTOMER: 'Waiting for payment', VENDOR: null, RIDER: null },
  AWAITING_VENDOR: {
    CUSTOMER: 'Confirming with store',
    VENDOR: 'New order',
    RIDER: null,
  },
  ACCEPTED: { CUSTOMER: 'Confirmed', VENDOR: 'Accepted', RIDER: null },
  REASSIGNING: { CUSTOMER: 'Finding another store', VENDOR: null, RIDER: null },
  PICKING: { CUSTOMER: 'Being packed', VENDOR: 'Picking', RIDER: null },
  SUBSTITUTION_PENDING: {
    CUSTOMER: 'Item unavailable — your choice needed',
    VENDOR: 'Awaiting customer',
    RIDER: null,
  },
  PACKED: { CUSTOMER: 'Packed', VENDOR: 'Ready for handover', RIDER: 'Ready for pickup' },
  READY_FOR_PICKUP: {
    CUSTOMER: 'Packed',
    VENDOR: 'Ready for handover',
    RIDER: 'Ready for pickup',
  },
  DISPATCHED: {
    CUSTOMER: 'Out for delivery',
    VENDOR: 'Handed over',
    RIDER: 'Delivering',
  },
  DELIVERED: { CUSTOMER: 'Delivered', VENDOR: 'Completed', RIDER: 'Delivered' },
  DELIVERY_FAILED: {
    CUSTOMER: 'Delivery attempt failed',
    VENDOR: 'Delivery failed',
    RIDER: 'Failed',
  },
  RTO: { CUSTOMER: 'Returning to store', VENDOR: 'Coming back', RIDER: 'Returning' },
  RETURN_REQUESTED: {
    CUSTOMER: 'Return requested',
    VENDOR: 'Return requested',
    RIDER: null,
  },
  RETURNED: { CUSTOMER: 'Returned', VENDOR: 'Returned', RIDER: null },
  COMPLETED: { CUSTOMER: 'Delivered', VENDOR: 'Completed', RIDER: null },
  CANCELLED: { CUSTOMER: 'Cancelled', VENDOR: 'Cancelled', RIDER: 'Cancelled' },
};

/**
 * What this audience calls the state.
 *
 * `null` means the state is not this audience's business — a rider has no
 * interest in whether a store has accepted yet — and the surface should show
 * nothing rather than leak internal vocabulary.
 */
export function labelFor(status: OrderStatus, audience: Audience): string | null {
  return LABELS[status][audience];
}

// ---------------------------------------------------------------------------
// The customer's timeline (§2.6.3, §4.2)
// ---------------------------------------------------------------------------

/**
 * What a customer watching their order actually sees.
 *
 * Deliberately fewer steps than the state machine has. A shopper does not care
 * that PICKING and SUBSTITUTION_PENDING are different states — they care that
 * their order is being packed. Seventeen states rendered as seventeen dots is a
 * progress bar nobody can read, and it leaks internal vocabulary the §2.6.3
 * labels exist to hide.
 */
export const CustomerStep = {
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  PACKING: 'PACKING',
  ON_THE_WAY: 'ON_THE_WAY',
  DELIVERED: 'DELIVERED',
} as const;

export type CustomerStep = (typeof CustomerStep)[keyof typeof CustomerStep];

/** Which canonical states each visible step covers. Order matters. */
const STEP_STATUSES: ReadonlyArray<{
  step: CustomerStep;
  statuses: readonly OrderStatus[];
}> = [
  {
    step: CustomerStep.PLACED,
    statuses: [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.AWAITING_VENDOR,
      OrderStatus.REASSIGNING,
    ],
  },
  { step: CustomerStep.CONFIRMED, statuses: [OrderStatus.ACCEPTED] },
  {
    step: CustomerStep.PACKING,
    statuses: [
      OrderStatus.PICKING,
      OrderStatus.SUBSTITUTION_PENDING,
      OrderStatus.PACKED,
      OrderStatus.READY_FOR_PICKUP,
    ],
  },
  {
    step: CustomerStep.ON_THE_WAY,
    statuses: [OrderStatus.DISPATCHED, OrderStatus.DELIVERY_FAILED],
  },
  {
    step: CustomerStep.DELIVERED,
    statuses: [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
  },
];

/**
 * States where the order stopped rather than progressed.
 *
 * The timeline must not keep showing "Out for delivery" as a future step for an
 * order that was cancelled — a progress bar that implies an order is still
 * coming is worse than no progress bar.
 */
export const ENDED_EARLY_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.RTO,
  OrderStatus.RETURN_REQUESTED,
  OrderStatus.RETURNED,
];

export const StepState = {
  DONE: 'DONE',
  CURRENT: 'CURRENT',
  UPCOMING: 'UPCOMING',
  /** Never reached, because the order ended first. */
  SKIPPED: 'SKIPPED',
} as const;

export type StepState = (typeof StepState)[keyof typeof StepState];

export interface TimelineStep {
  step: CustomerStep;
  state: StepState;
  /** When it happened. Null for anything not yet reached. */
  at: string | null;
}

export interface CustomerTimeline {
  steps: TimelineStep[];
  /** True when the order stopped early — the UI shows why instead of a bar. */
  endedEarly: boolean;
}

function stepIndexOf(status: OrderStatus): number {
  return STEP_STATUSES.findIndex((entry) => entry.statuses.includes(status));
}

/**
 * Builds the timeline from the status history.
 *
 * Timestamps come from history rather than from the order row, because the row
 * only knows *where* an order is. "Confirmed at 6:04pm" is the thing a waiting
 * customer actually wants, and it is only recoverable from the audit trail.
 */
export function customerTimeline(
  current: OrderStatus,
  history: ReadonlyArray<{ toStatus: string; createdAt: string | Date }>,
): CustomerTimeline {
  const endedEarly = ENDED_EARLY_STATUSES.includes(current);
  const currentIndex = stepIndexOf(current);

  // The furthest step the order ever reached — not the same as where it is now.
  // A cancelled order that was already packed should still show packing done.
  let reachedIndex = currentIndex;
  const firstSeenAt = new Map<CustomerStep, string>();

  for (const entry of history) {
    const index = stepIndexOf(entry.toStatus as OrderStatus);
    if (index < 0) continue;

    const step = STEP_STATUSES[index]!.step;
    if (!firstSeenAt.has(step)) {
      firstSeenAt.set(
        step,
        entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
      );
    }
    if (index > reachedIndex) reachedIndex = index;
  }

  const steps = STEP_STATUSES.map(({ step }, index) => {
    let state: StepState;

    if (index < reachedIndex) state = StepState.DONE;
    else if (index === reachedIndex)
      state = endedEarly ? StepState.DONE : StepState.CURRENT;
    else state = endedEarly ? StepState.SKIPPED : StepState.UPCOMING;

    // A delivered order has no "current" step left; everything is done.
    if (
      !endedEarly &&
      index === reachedIndex &&
      (current === OrderStatus.DELIVERED || current === OrderStatus.COMPLETED)
    ) {
      state = StepState.DONE;
    }

    return { step, state, at: firstSeenAt.get(step) ?? null };
  });

  return { steps, endedEarly };
}
