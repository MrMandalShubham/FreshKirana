import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  OrderStatus,
  ProductStatus,
  Role,
  ServiceAreaMode,
  Uom,
  istDateKey,
  istDayOfWeek,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import type { SlotView } from '../../serviceability/contracts';

loadEnv();

const dbUp = await requireDatabase('"order".order_status_history');

/** Its own patch of the map for this run — see the serviceability suite. */
const STORE = {
  latitude: 8 + Math.random() * 9,
  longitude: 70 + Math.random() * 14,
};
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  label: string;
  nextActions?: Array<{ to: string; requiresReason: boolean }>;
  history?: Array<{
    fromStatus: string | null;
    toStatus: string;
    actorRole: string | null;
  }>;
}

describe.skipIf(!dbUp)('order state machine (e2e)', () => {
  let app: INestApplication;

  let adminToken: string;
  let customerToken: string;
  let vendorToken: string;
  let riderToken: string;
  let opsToken: string;

  let vendorId: string;
  let addressId: string;
  let offerId: string;
  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function login(role: Role, vendor?: string): Promise<string> {
    const res = await http()
      .post('/dev/login-as')
      .send(vendor ? { role, vendorId: vendor } : { role })
      .expect(201);
    return (res.body as { token: string }).token;
  }

  /** Places a fresh COD order and returns it in AWAITING_VENDOR. */
  async function placeOrder(): Promise<OrderView> {
    await as(customerToken)(http().delete('/cart')).expect(200);
    await as(customerToken)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity: 1 })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);

    const slot = (slots.body as SlotView[]).find((s) => s.isBookable);
    if (!slot) throw new Error('fixture: no bookable slot');

    const res = await as(customerToken)(http().post('/checkout/place'))
      .send({ addressId, slotInstanceId: slot.id })
      .expect(201);

    return res.body as OrderView;
  }

  /** A store-side move. Not async: callers chain `.expect(...)`. */
  function vendorMoves(orderId: string, to: OrderStatus, reason?: string) {
    return as(vendorToken)(
      http().post(`/vendor/${vendorId}/orders/${orderId}/transitions`),
    ).send(reason ? { to, reason } : { to });
  }

  /** A rider-side move. Not async: callers chain `.expect(...)`. */
  function riderMoves(orderId: string, to: OrderStatus, reason?: string) {
    return as(riderToken)(http().post(`/orders/${orderId}/transitions`)).send(
      reason ? { to, reason } : { to },
    );
  }

  async function customerSees(orderId: string): Promise<OrderView> {
    const res = await as(customerToken)(http().get(`/me/orders/${orderId}`)).expect(200);
    return res.body as OrderView;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    adminToken = await login(Role.ADMIN);
    customerToken = await login(Role.CUSTOMER);
    riderToken = await login(Role.RIDER);
    opsToken = await login(Role.OPS);

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'State Machine Traders',
        displayName: 'State Machine Store',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    vendorId = (vendor.body as { id: string }).id;

    await http()
      .patch(`/admin/vendors/${vendorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await http()
      .put(`/vendor/${vendorId}/service-area`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        mode: ServiceAreaMode.RADIUS,
        centreLatitude: STORE.latitude,
        centreLongitude: STORE.longitude,
        radiusMeters: 3_000,
      })
      .expect(200);

    const tomorrow = istDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await http()
      .put(`/vendor/${vendorId}/slot-definitions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dayOfWeek: istDayOfWeek(tomorrow),
        startMinute: 600,
        endMinute: 720,
        pickingCapacityOrders: 50,
        deliveryCapacityOrders: 50,
      })
      .expect(200);

    vendorToken = await login(Role.VENDOR_STAFF, vendorId);

    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `State Fixture ${randomUUID()}`,
        categoryId,
        netQuantity: 1,
        uom: Uom.KG,
        isPrepackaged: true,
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
        eanBarcode: uniqueEan(),
        manufacturerPacker: 'Test Packer',
        countryOfOrigin: 'India',
        consumerCareContact: 'care@example.com',
        status: ProductStatus.ACTIVE,
      })
      .expect(201);

    const offer = await http()
      .post(`/vendor/${vendorId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId: (product.body as { id: string }).id,
        mrpPaise: 30_000,
        sellingPricePaise: 30_000,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);
    offerId = (offer.body as { id: string }).id;

    const address = await as(customerToken)(http().post('/me/addresses'))
      .send({
        label: 'HOME',
        recipientName: 'Test Recipient',
        recipientPhone: '+919812345678',
        line1: '42 Some Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        ...NEARBY,
      })
      .expect(201);
    addressId = (address.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the happy path, end to end', () => {
    let orderId: string;

    beforeAll(async () => {
      orderId = (await placeOrder()).id;
    });

    it('starts where checkout left it', async () => {
      const order = await customerSees(orderId);
      expect(order.status).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('walks the whole machine to delivered', async () => {
      await vendorMoves(orderId, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(orderId, OrderStatus.PICKING).expect(201);
      await vendorMoves(orderId, OrderStatus.PACKED).expect(201);
      await vendorMoves(orderId, OrderStatus.READY_FOR_PICKUP).expect(201);
      await riderMoves(orderId, OrderStatus.DISPATCHED).expect(201);
      await riderMoves(orderId, OrderStatus.DELIVERED).expect(201);

      expect((await customerSees(orderId)).status).toBe(OrderStatus.DELIVERED);
    });

    it('records every step, with who made it', async () => {
      // The trail that settles "the store says they accepted at 6" (§3.8).
      const order = await customerSees(orderId);
      const history = order.history!;

      expect(history[0]?.fromStatus).toBeNull();
      expect(history[0]?.toStatus).toBe(OrderStatus.AWAITING_VENDOR);

      expect(history.map((h) => h.toStatus)).toEqual([
        OrderStatus.AWAITING_VENDOR,
        OrderStatus.ACCEPTED,
        OrderStatus.PICKING,
        OrderStatus.PACKED,
        OrderStatus.READY_FOR_PICKUP,
        OrderStatus.DISPATCHED,
        OrderStatus.DELIVERED,
      ]);

      expect(history.find((h) => h.toStatus === OrderStatus.ACCEPTED)?.actorRole).toBe(
        Role.VENDOR_STAFF,
      );
      expect(history.find((h) => h.toStatus === OrderStatus.DELIVERED)?.actorRole).toBe(
        Role.RIDER,
      );
    });

    it('completes after delivery', async () => {
      await as(opsToken)(http().post(`/orders/${orderId}/transitions`))
        .send({ to: OrderStatus.COMPLETED })
        .expect(201);

      expect((await customerSees(orderId)).status).toBe(OrderStatus.COMPLETED);
    });

    it('still allows a return once completed', async () => {
      // §2.6.1 — the customer opens the bag after the rider has gone.
      const res = await as(opsToken)(http().post(`/orders/${orderId}/transitions`))
        .send({ to: OrderStatus.RETURN_REQUESTED, reason: 'Item spoiled' })
        .expect(201);

      expect((res.body as OrderView).status).toBe(OrderStatus.RETURN_REQUESTED);
    });
  });

  describe('one state, three vocabularies (§2.6.3)', () => {
    it('calls the same order different things', async () => {
      const orderId = (await placeOrder()).id;
      await vendorMoves(orderId, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(orderId, OrderStatus.PICKING).expect(201);
      const packed = await vendorMoves(orderId, OrderStatus.PACKED).expect(201);

      // The store is told it is ready to hand over.
      expect((packed.body as OrderView).label).toBe('Ready for handover');

      // The customer is told it is packed.
      expect((await customerSees(orderId)).label).toBe('Packed');

      // And the rider is told it is waiting for them.
      await vendorMoves(orderId, OrderStatus.READY_FOR_PICKUP).expect(201);
      const dispatched = await riderMoves(orderId, OrderStatus.DISPATCHED);
      expect(dispatched.status).toBe(201);
      expect((dispatched.body as OrderView).label).toBe('Delivering');

      // One canonical state underneath all three.
      expect((await customerSees(orderId)).status).toBe(OrderStatus.DISPATCHED);
    });

    it('tells each surface what it may do next', async () => {
      const orderId = (await placeOrder()).id;

      const customer = await customerSees(orderId);
      expect(customer.nextActions?.map((a) => a.to)).toEqual([OrderStatus.CANCELLED]);

      const queue = await as(vendorToken)(
        http().get(`/vendor/${vendorId}/orders`),
      ).expect(200);
      const mine = (queue.body as OrderView[]).find((o) => o.id === orderId)!;
      expect(mine.nextActions?.map((a) => a.to).sort()).toEqual([
        OrderStatus.ACCEPTED,
        OrderStatus.REASSIGNING,
      ]);
      expect(
        mine.nextActions?.find((a) => a.to === OrderStatus.REASSIGNING)?.requiresReason,
      ).toBe(true);
    });
  });

  describe('what the machine refuses', () => {
    let orderId: string;

    beforeAll(async () => {
      orderId = (await placeOrder()).id;
      await vendorMoves(orderId, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(orderId, OrderStatus.PICKING).expect(201);
      await vendorMoves(orderId, OrderStatus.PACKED).expect(201);
    });

    it('refuses to run backwards', async () => {
      // The plan's illegal example: packed goods do not become un-packed.
      const res = await vendorMoves(orderId, OrderStatus.AWAITING_VENDOR).expect(409);

      const body = res.body as { code: string; allowed: string[] };
      expect(body.code).toBe('ILLEGAL_TRANSITION');
      // And it says where the order *can* go, so a client can recover.
      expect(body.allowed).toContain(OrderStatus.READY_FOR_PICKUP);
    });

    it('refuses to skip the middle', async () => {
      const fresh = (await placeOrder()).id;
      await vendorMoves(fresh, OrderStatus.DELIVERED).expect(409);
    });

    it('refuses a move this role may never make', async () => {
      // A store marking its own order delivered is how a COD order gets
      // settled against cash nobody collected. The move is legal from here —
      // for a rider — so this is a 403 about *who*, not a 409 about *what*.
      const ready = (await placeOrder()).id;
      await vendorMoves(ready, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(ready, OrderStatus.PICKING).expect(201);
      await vendorMoves(ready, OrderStatus.PACKED).expect(201);
      await vendorMoves(ready, OrderStatus.READY_FOR_PICKUP).expect(201);
      await riderMoves(ready, OrderStatus.DISPATCHED).expect(201);

      const res = await vendorMoves(ready, OrderStatus.DELIVERED).expect(403);
      const body = res.body as { code: string; allowed: string[] };
      expect(body.code).toBe('TRANSITION_NOT_PERMITTED');
      // And it says what this role *could* do instead.
      expect(body.allowed).toEqual([]);
    });

    it('refuses a rejection with no reason', async () => {
      const fresh = (await placeOrder()).id;
      const res = await vendorMoves(fresh, OrderStatus.REASSIGNING).expect(400);
      expect((res.body as { code: string }).code).toBe('REASON_REQUIRED');

      await vendorMoves(fresh, OrderStatus.REASSIGNING, 'Out of stock').expect(201);
    });

    it('refuses a customer the transition endpoint entirely', async () => {
      // The generic endpoint is for riders, fleet managers and ops. A customer
      // has exactly one state change available to them, and it has its own
      // route with its own §1.8.1 window.
      await as(customerToken)(http().post(`/orders/${orderId}/transitions`))
        .send({ to: OrderStatus.READY_FOR_PICKUP })
        .expect(403);
    });

    it('lets only one of two simultaneous moves land', async () => {
      // A store accepting while ops reassigns. The second is told the order
      // moved rather than silently overwriting the first.
      const fresh = (await placeOrder()).id;

      const [a, b] = await Promise.all([
        vendorMoves(fresh, OrderStatus.ACCEPTED),
        as(opsToken)(http().post(`/orders/${fresh}/transitions`)).send({
          to: OrderStatus.REASSIGNING,
          reason: 'SLA lapsed',
        }),
      ]);

      const outcomes = [a.status, b.status].sort();
      expect(outcomes[0]).toBe(201);
      expect(outcomes[1]).toBeGreaterThanOrEqual(409);
    });
  });

  describe('cancellation (§1.8.1)', () => {
    it('lets the customer cancel before the store packs', async () => {
      const orderId = (await placeOrder()).id;

      const res = await as(customerToken)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(201);

      expect((res.body as OrderView).status).toBe(OrderStatus.CANCELLED);
      expect((res.body as OrderView).label).toBe('Cancelled');
    });

    it('gives the delivery slot back', async () => {
      // A cancelled order holding a place is capacity nobody can use.
      const slotsBefore = await http()
        .get(`/serviceability/stores/${vendorId}/slots`)
        .query({ days: 3 })
        .expect(200);
      const target = (slotsBefore.body as SlotView[]).find((s) => s.isBookable)!;
      const bookedBefore = target.booked;

      const orderId = (await placeOrder()).id;

      const during = await http()
        .get(`/serviceability/stores/${vendorId}/slots`)
        .query({ days: 3 })
        .expect(200);
      expect((during.body as SlotView[]).find((s) => s.id === target.id)!.booked).toBe(
        bookedBefore + 1,
      );

      await as(customerToken)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(201);

      const after = await http()
        .get(`/serviceability/stores/${vendorId}/slots`)
        .query({ days: 3 })
        .expect(200);
      expect((after.body as SlotView[]).find((s) => s.id === target.id)!.booked).toBe(
        bookedBefore,
      );
    });

    it('refuses once the order is out for delivery', async () => {
      // §1.8.1: "No — contact support". The goods are in a rider's hands.
      const orderId = (await placeOrder()).id;
      await vendorMoves(orderId, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(orderId, OrderStatus.PICKING).expect(201);
      await vendorMoves(orderId, OrderStatus.PACKED).expect(201);
      await vendorMoves(orderId, OrderStatus.READY_FOR_PICKUP).expect(201);
      await riderMoves(orderId, OrderStatus.DISPATCHED).expect(201);

      await as(customerToken)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(409);
    });

    it("refuses to cancel somebody else's order", async () => {
      const orderId = (await placeOrder()).id;
      const stranger = await login(Role.VENDOR_OWNER);

      // 404, not 403 — the response must not confirm the order exists.
      await as(stranger)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Not mine' })
        .expect(404);
    });
  });

  describe('delivery that goes wrong (§2.9.3)', () => {
    it('records a failure with its reason, then allows one retry', async () => {
      const orderId = (await placeOrder()).id;
      await vendorMoves(orderId, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(orderId, OrderStatus.PICKING).expect(201);
      await vendorMoves(orderId, OrderStatus.PACKED).expect(201);
      await vendorMoves(orderId, OrderStatus.READY_FOR_PICKUP).expect(201);
      await riderMoves(orderId, OrderStatus.DISPATCHED).expect(201);

      await riderMoves(orderId, OrderStatus.DELIVERY_FAILED).expect(400);
      await riderMoves(
        orderId,
        OrderStatus.DELIVERY_FAILED,
        'Customer unavailable',
      ).expect(201);

      // The retry §2.9.3 allows.
      await riderMoves(orderId, OrderStatus.DISPATCHED).expect(201);
      await riderMoves(orderId, OrderStatus.DELIVERY_FAILED, 'Still nobody home').expect(
        201,
      );

      // Then back to the store.
      await riderMoves(orderId, OrderStatus.RTO).expect(201);
      const order = await customerSees(orderId);
      expect(order.status).toBe(OrderStatus.RTO);
      expect(order.label).toBe('Returning to store');

      expect(
        order.history!.filter((h) => h.toStatus === OrderStatus.DELIVERY_FAILED),
      ).toHaveLength(2);
    });
  });

  describe('the database constraint, not just the service check', () => {
    it('refuses a history row that records no movement', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into "order".order_status_history (order_id, from_status, to_status)
          values ('${randomUUID()}', 'PACKED', 'PACKED')
        `),
      ).rejects.toThrow(/order_status_history_moved|violates foreign key/);
    });
  });
});
