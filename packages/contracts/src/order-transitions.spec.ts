import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
  isTerminalOrderStatus,
} from './order-status';
import {
  Audience,
  ORDER_TRANSITIONS,
  StepState,
  customerTimeline,
  TransitionEffect,
  TransitionGuard,
  allowedTransitions,
  findTransition,
  isTransitionAllowed,
  labelFor,
  nextStatuses,
} from './order-transitions';
import { Role } from './roles';

describe('the transition table', () => {
  it('declares each move exactly once', () => {
    // Two rows for the same move means two answers about who may make it, and
    // whichever the lookup finds first silently wins.
    const seen = ORDER_TRANSITIONS.map((t) => `${t.from}->${t.to}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('never lets an order sit somewhere it cannot leave', () => {
    // A state with no way out is an order stuck forever, and support cannot
    // fix it without writing to the database by hand.
    for (const status of ORDER_STATUSES) {
      if (isTerminalOrderStatus(status)) continue;
      if (status === OrderStatus.DRAFT) continue; // never persisted; checkout writes AWAITING_VENDOR

      expect(
        nextStatuses(status).length,
        `${status} has no outgoing transition`,
      ).toBeGreaterThan(0);
    }
  });

  it('leaves the terminal states alone', () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(nextStatuses(status), `${status} should be terminal`).toEqual([]);
    }
  });

  it('keeps the return path open after an order is completed', () => {
    // §2.6.1 — the customer opens the bag after the rider has gone.
    expect(
      findTransition(OrderStatus.COMPLETED, OrderStatus.RETURN_REQUESTED),
    ).toBeDefined();
  });

  it('can reach every state from where an order actually starts', () => {
    // Checkout writes AWAITING_VENDOR (COD) or PENDING_PAYMENT (prepaid). A
    // state nothing can reach is a state that will never be tested in
    // production either.
    const reached = new Set<OrderStatus>([
      OrderStatus.AWAITING_VENDOR,
      OrderStatus.PENDING_PAYMENT,
    ]);

    let growing = true;
    while (growing) {
      growing = false;
      for (const transition of ORDER_TRANSITIONS) {
        if (reached.has(transition.from) && !reached.has(transition.to)) {
          reached.add(transition.to);
          growing = true;
        }
      }
    }

    const unreachable = ORDER_STATUSES.filter(
      (status) => status !== OrderStatus.DRAFT && !reached.has(status),
    );
    expect(unreachable).toEqual([]);
  });

  it('lets ops intervene on every transition', () => {
    // Reality does not follow the diagram. Without this, support corrects
    // state with an UPDATE and leaves no audit trail (§3.8).
    for (const transition of ORDER_TRANSITIONS) {
      expect(
        transition.actors,
        `${transition.from}->${transition.to} excludes ops`,
      ).toContain(Role.OPS);
    }
  });
});

describe('who may do what', () => {
  it('lets a store accept a new order', () => {
    expect(
      isTransitionAllowed(
        OrderStatus.AWAITING_VENDOR,
        OrderStatus.ACCEPTED,
        Role.VENDOR_STAFF,
      ),
    ).toBe(true);
  });

  it('does not let a customer accept their own order', () => {
    expect(
      isTransitionAllowed(
        OrderStatus.AWAITING_VENDOR,
        OrderStatus.ACCEPTED,
        Role.CUSTOMER,
      ),
    ).toBe(false);
  });

  it('does not let a store mark its own order delivered', () => {
    // The rider is at the door; the store is not. A vendor marking delivery
    // is how a COD order gets settled against cash nobody collected.
    expect(
      isTransitionAllowed(
        OrderStatus.DISPATCHED,
        OrderStatus.DELIVERED,
        Role.VENDOR_OWNER,
      ),
    ).toBe(false);
    expect(
      isTransitionAllowed(OrderStatus.DISPATCHED, OrderStatus.DELIVERED, Role.RIDER),
    ).toBe(true);
  });

  it('offers a role only the moves it can actually make', () => {
    const forVendor = allowedTransitions(OrderStatus.AWAITING_VENDOR, Role.VENDOR_STAFF);
    expect(forVendor.map((t) => t.to).sort()).toEqual([
      OrderStatus.ACCEPTED,
      OrderStatus.REASSIGNING,
    ]);

    const forCustomer = allowedTransitions(OrderStatus.AWAITING_VENDOR, Role.CUSTOMER);
    expect(forCustomer.map((t) => t.to)).toEqual([OrderStatus.CANCELLED]);
  });

  it('refuses the move that runs the machine backwards', () => {
    // The plan's illegal example. Packed goods do not become un-packed.
    expect(
      findTransition(OrderStatus.PACKED, OrderStatus.AWAITING_VENDOR),
    ).toBeUndefined();
    expect(
      isTransitionAllowed(OrderStatus.PACKED, OrderStatus.AWAITING_VENDOR, Role.ADMIN),
    ).toBe(false);
  });

  it('refuses to skip the middle of the machine', () => {
    expect(
      findTransition(OrderStatus.AWAITING_VENDOR, OrderStatus.DELIVERED),
    ).toBeUndefined();
  });
});

describe('cancellation follows §1.8.1', () => {
  const customerMayCancelFrom = [
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.AWAITING_VENDOR,
    OrderStatus.ACCEPTED,
    OrderStatus.PICKING,
    OrderStatus.PACKED,
  ];

  it('lets the customer cancel up to and including packed', () => {
    for (const status of customerMayCancelFrom) {
      expect(
        isTransitionAllowed(status, OrderStatus.CANCELLED, Role.CUSTOMER),
        `customer should be able to cancel from ${status}`,
      ).toBe(true);
    }
  });

  it('stops once the order is out for delivery', () => {
    // §1.8.1: "No — contact support". The goods are in a rider's hands.
    expect(
      isTransitionAllowed(OrderStatus.DISPATCHED, OrderStatus.CANCELLED, Role.CUSTOMER),
    ).toBe(false);
    expect(
      isTransitionAllowed(OrderStatus.DELIVERED, OrderStatus.CANCELLED, Role.CUSTOMER),
    ).toBe(false);
  });

  it('gives the delivery slot back every time', () => {
    // A cancelled order holding a place is capacity the store cannot sell and
    // a shopper cannot book.
    const cancellations = ORDER_TRANSITIONS.filter((t) => t.to === OrderStatus.CANCELLED);

    expect(cancellations.length).toBeGreaterThan(0);
    for (const transition of cancellations) {
      expect(
        transition.effects,
        `${transition.from}->CANCELLED does not release the slot`,
      ).toContain(TransitionEffect.RELEASE_SLOT);
    }
  });

  it('demands a reason where one feeds the vendor score', () => {
    expect(
      findTransition(OrderStatus.AWAITING_VENDOR, OrderStatus.REASSIGNING)?.guards,
    ).toContain(TransitionGuard.REASON_REQUIRED);
    expect(
      findTransition(OrderStatus.DISPATCHED, OrderStatus.DELIVERY_FAILED)?.guards,
    ).toContain(TransitionGuard.REASON_REQUIRED);
  });
});

describe('role-specific labels (§2.6.3)', () => {
  it('shows one state three ways', () => {
    expect(labelFor(OrderStatus.PACKED, Audience.CUSTOMER)).toBe('Packed');
    expect(labelFor(OrderStatus.PACKED, Audience.VENDOR)).toBe('Ready for handover');
    expect(labelFor(OrderStatus.PACKED, Audience.RIDER)).toBe('Ready for pickup');
  });

  it('matches the §2.6.3 table', () => {
    expect(labelFor(OrderStatus.AWAITING_VENDOR, Audience.CUSTOMER)).toBe(
      'Confirming with store',
    );
    expect(labelFor(OrderStatus.AWAITING_VENDOR, Audience.VENDOR)).toBe('New order');
    expect(labelFor(OrderStatus.DISPATCHED, Audience.CUSTOMER)).toBe('Out for delivery');
    expect(labelFor(OrderStatus.DISPATCHED, Audience.RIDER)).toBe('Delivering');
  });

  it('says nothing to an audience the state does not concern', () => {
    // A rider has no interest in whether a store has accepted yet, and showing
    // them the raw state name would leak internal vocabulary.
    expect(labelFor(OrderStatus.AWAITING_VENDOR, Audience.RIDER)).toBeNull();
  });

  it('has a customer label for every state', () => {
    // The customer always sees *something*: a blank status reads as a broken
    // app, and this is the surface a real person is refreshing.
    for (const status of ORDER_STATUSES) {
      expect(
        labelFor(status, Audience.CUSTOMER),
        `no customer label for ${status}`,
      ).toBeTruthy();
    }
  });
});

describe('the customer timeline', () => {
  const at = (minutes: number) =>
    new Date(Date.parse('2026-08-18T10:00:00Z') + minutes * 60_000).toISOString();

  const history = (...entries: Array<[OrderStatus, number]>) =>
    entries.map(([toStatus, minutes]) => ({ toStatus, createdAt: at(minutes) }));

  it('shows five steps, not seventeen states', () => {
    // A shopper does not care that PICKING and SUBSTITUTION_PENDING differ.
    const { steps } = customerTimeline(
      OrderStatus.AWAITING_VENDOR,
      history([OrderStatus.AWAITING_VENDOR, 0]),
    );
    expect(steps).toHaveLength(5);
  });

  it('marks where the order is now', () => {
    const { steps } = customerTimeline(
      OrderStatus.PICKING,
      history(
        [OrderStatus.AWAITING_VENDOR, 0],
        [OrderStatus.ACCEPTED, 3],
        [OrderStatus.PICKING, 8],
      ),
    );

    expect(steps.map((s) => s.state)).toEqual([
      StepState.DONE,
      StepState.DONE,
      StepState.CURRENT,
      StepState.UPCOMING,
      StepState.UPCOMING,
    ]);
  });

  it('carries the time each step happened', () => {
    // "Confirmed at 6:04pm" is what a waiting customer wants, and only the
    // audit trail knows it — the order row only knows where it is now.
    const { steps } = customerTimeline(
      OrderStatus.ACCEPTED,
      history([OrderStatus.AWAITING_VENDOR, 0], [OrderStatus.ACCEPTED, 4]),
    );

    expect(steps[0]?.at).toBe(at(0));
    expect(steps[1]?.at).toBe(at(4));
    expect(steps[2]?.at).toBeNull();
  });

  it('does not collapse states that share a step', () => {
    // PICKING then PACKED are one step to the customer, and it should keep the
    // time it *started*, not the time it last moved within itself.
    const { steps } = customerTimeline(
      OrderStatus.PACKED,
      history(
        [OrderStatus.AWAITING_VENDOR, 0],
        [OrderStatus.ACCEPTED, 3],
        [OrderStatus.PICKING, 8],
        [OrderStatus.PACKED, 20],
      ),
    );

    expect(steps[2]?.at).toBe(at(8));
  });

  it('finishes with nothing current once delivered', () => {
    const { steps } = customerTimeline(
      OrderStatus.DELIVERED,
      history(
        [OrderStatus.AWAITING_VENDOR, 0],
        [OrderStatus.ACCEPTED, 3],
        [OrderStatus.PICKING, 8],
        [OrderStatus.DISPATCHED, 30],
        [OrderStatus.DELIVERED, 55],
      ),
    );

    expect(steps.every((s) => s.state === StepState.DONE)).toBe(true);
  });

  it('stops promising delivery for a cancelled order', () => {
    // A progress bar that still shows "On the way" ahead of a cancelled order
    // is worse than no progress bar at all.
    const { steps, endedEarly } = customerTimeline(
      OrderStatus.CANCELLED,
      history([OrderStatus.AWAITING_VENDOR, 0], [OrderStatus.CANCELLED, 12]),
    );

    expect(endedEarly).toBe(true);
    expect(steps.filter((s) => s.state === StepState.UPCOMING)).toHaveLength(0);
    expect(steps.slice(1).every((s) => s.state === StepState.SKIPPED)).toBe(true);
  });

  it('keeps what did happen before a late cancellation', () => {
    // Cancelled after packing: the packing happened, and the timeline should
    // not rewrite history to say otherwise.
    const { steps } = customerTimeline(
      OrderStatus.CANCELLED,
      history(
        [OrderStatus.AWAITING_VENDOR, 0],
        [OrderStatus.ACCEPTED, 3],
        [OrderStatus.PACKED, 25],
        [OrderStatus.CANCELLED, 30],
      ),
    );

    expect(steps[0]?.state).toBe(StepState.DONE);
    expect(steps[1]?.state).toBe(StepState.DONE);
    expect(steps[2]?.state).toBe(StepState.DONE);
    expect(steps[3]?.state).toBe(StepState.SKIPPED);
  });

  it('survives an empty history', () => {
    // A brand-new order read before its first history row lands.
    const { steps } = customerTimeline(OrderStatus.AWAITING_VENDOR, []);
    expect(steps[0]?.state).toBe(StepState.CURRENT);
  });
});
