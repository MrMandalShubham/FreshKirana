import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderStatus,
  ProductStatus,
  Role,
  ServiceAreaMode,
  StepState,
  Uom,
  istDateKey,
  istDayOfWeek,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { requireDatabase } from '../../../testing/database';
import type { SlotView } from '../../serviceability/contracts';

loadEnv();

const dbUp = await requireDatabase('"order".order_status_history');

if (!dbUp) {
  console.warn('\n  order tracking (e2e) SKIPPED - no migrated database.\n');
}

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface TimelineResponse {
  status: string;
  label: string;
  timeline: {
    endedEarly: boolean;
    steps: Array<{ step: string; state: string; at: string | null }>;
  };
}

describe.skipIf(!dbUp)('order tracking (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;
  let riderToken: string;

  let vendorId: string;
  let addressId: string;
  let offerId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function placeOrder(): Promise<string> {
    await as(customerToken)(http().delete('/cart')).expect(200);
    await as(customerToken)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity: 1 })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);

    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const res = await as(customerToken)(http().post('/checkout/place'))
      .send({ addressId, slotInstanceId: slot.id })
      .expect(201);

    return (res.body as { id: string }).id;
  }

  /** The store's route: vendor-scoped, and closed to riders (§3.2). */
  async function move(orderId: string, to: OrderStatus, reason?: string) {
    return http()
      .post(`/vendor/${vendorId}/orders/${orderId}/transitions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to, ...(reason ? { reason } : {}) })
      .expect(201);
  }

  /** The rider's route. A rider has no business on a vendor-scoped path. */
  async function riderMoves(orderId: string, to: OrderStatus, reason?: string) {
    return http()
      .post(`/orders/${orderId}/transitions`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ to, ...(reason ? { reason } : {}) })
      .expect(201);
  }

  async function track(orderId: string): Promise<TimelineResponse> {
    const res = await as(customerToken)(http().get(`/me/orders/${orderId}`)).expect(200);
    return res.body as TimelineResponse;
  }

  const stepStates = (timeline: TimelineResponse) =>
    Object.fromEntries(timeline.timeline.steps.map((s) => [s.step, s.state]));

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

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const customer = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER })
      .expect(201);
    customerToken = (customer.body as { token: string }).token;

    const rider = await http()
      .post('/dev/login-as')
      .send({ role: Role.RIDER })
      .expect(201);
    riderToken = (rider.body as { token: string }).token;

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Tracking Test Traders',
        displayName: 'Tracking Test Store',
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
        pickingCapacityOrders: 100,
        deliveryCapacityOrders: 100,
      })
      .expect(200);

    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Tracking Fixture ${randomUUID()}`,
        categoryId: (category.body as { id: string }).id,
        netQuantity: 1,
        uom: Uom.KG,
        isPrepackaged: true,
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
        eanBarcode: `89${Math.floor(Math.random() * 1e11)
          .toString()
          .padStart(11, '0')}`,
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
        mrpPaise: 60_000,
        sellingPricePaise: 60_000,
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

  describe('the timeline a customer watches', () => {
    it('starts with the order placed and nothing else', async () => {
      const orderId = await placeOrder();
      const view = await track(orderId);

      expect(view.label).toBe('Confirming with store');
      expect(stepStates(view)).toEqual({
        PLACED: StepState.CURRENT,
        CONFIRMED: StepState.UPCOMING,
        PACKING: StepState.UPCOMING,
        ON_THE_WAY: StepState.UPCOMING,
        DELIVERED: StepState.UPCOMING,
      });
    });

    it('advances as the store works, in the customer’s words', async () => {
      const orderId = await placeOrder();

      await move(orderId, OrderStatus.ACCEPTED);
      expect((await track(orderId)).label).toBe('Confirmed');

      await move(orderId, OrderStatus.PICKING);
      const packing = await track(orderId);
      expect(packing.label).toBe('Being packed');
      expect(stepStates(packing).PACKING).toBe(StepState.CURRENT);
      expect(stepStates(packing).CONFIRMED).toBe(StepState.DONE);
    });

    it('records when each step happened', async () => {
      const orderId = await placeOrder();
      await move(orderId, OrderStatus.ACCEPTED);

      const view = await track(orderId);
      const confirmed = view.timeline.steps.find((s) => s.step === 'CONFIRMED');

      expect(confirmed?.at).toBeTruthy();
      expect(new Date(confirmed!.at!).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('runs to the door', async () => {
      const orderId = await placeOrder();

      await move(orderId, OrderStatus.ACCEPTED);
      await move(orderId, OrderStatus.PICKING);
      await move(orderId, OrderStatus.PACKED);
      await move(orderId, OrderStatus.READY_FOR_PICKUP);
      await move(orderId, OrderStatus.DISPATCHED);

      const onTheWay = await track(orderId);
      expect(onTheWay.label).toBe('Out for delivery');
      expect(stepStates(onTheWay).ON_THE_WAY).toBe(StepState.CURRENT);

      await riderMoves(orderId, OrderStatus.DELIVERED);

      const delivered = await track(orderId);
      expect(delivered.label).toBe('Delivered');
      expect(delivered.timeline.steps.every((s) => s.state === StepState.DONE)).toBe(
        true,
      );
    });

    it('stops promising delivery once cancelled', async () => {
      const orderId = await placeOrder();
      await as(customerToken)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(201);

      const view = await track(orderId);

      expect(view.timeline.endedEarly).toBe(true);
      expect(view.timeline.steps.some((s) => s.state === StepState.UPCOMING)).toBe(false);
    });
  });

  describe('the shopper is told', () => {
    async function inbox() {
      const res = await as(customerToken)(http().get('/me/notifications')).expect(200);
      return res.body as {
        unread: number;
        items: Array<{ id: string; template: string; orderId: string | null }>;
      };
    }

    it('sends a notification when the store confirms', async () => {
      const orderId = await placeOrder();
      await move(orderId, OrderStatus.ACCEPTED);

      // Sent without being awaited into the response, so the customer's screen
      // never waits on a provider.
      await new Promise((resolve) => setTimeout(resolve, 900));

      const { items } = await inbox();
      const forOrder = items.filter((item) => item.orderId === orderId);

      expect(forOrder.map((i) => i.template)).toContain(
        NotificationTemplate.ORDER_CONFIRMED,
      );
    });

    it('stays quiet about states that are the store’s business', async () => {
      // Nobody wants to be told their order moved from PICKING to PACKED-ish
      // internals. Notifying on everything trains people to ignore the one
      // that mattered.
      const orderId = await placeOrder();
      await move(orderId, OrderStatus.ACCEPTED);
      await move(orderId, OrderStatus.PICKING);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const { items } = await inbox();
      const forOrder = items.filter((item) => item.orderId === orderId);

      expect(forOrder.map((i) => i.template)).not.toContain(
        NotificationTemplate.ORDER_REMINDER,
      );
      expect(forOrder).toHaveLength(1);
    });

    it('counts what has not been read, and clears it', async () => {
      const orderId = await placeOrder();
      await move(orderId, OrderStatus.ACCEPTED);
      await new Promise((resolve) => setTimeout(resolve, 900));

      expect((await inbox()).unread).toBeGreaterThan(0);

      await as(customerToken)(http().post('/me/notifications/read')).expect(201);
      expect((await inbox()).unread).toBe(0);

      void orderId;
    });

    it('shows nobody else’s notifications', async () => {
      const other = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_OWNER })
        .expect(201);

      const res = await as((other.body as { token: string }).token)(
        http().get('/me/notifications'),
      ).expect(200);

      const mine = await inbox();
      const theirs = res.body as { items: Array<{ id: string }> };
      const overlap = theirs.items.filter((item) =>
        mine.items.some((m) => m.id === item.id),
      );

      expect(overlap).toHaveLength(0);
    });

    it('requires a signed-in shopper', async () => {
      await http().get('/me/notifications').expect(401);
    });
  });
});
