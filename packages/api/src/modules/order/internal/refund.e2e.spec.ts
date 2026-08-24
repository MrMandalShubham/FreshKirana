import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  RefundReason,
  RefundRoute,
  RefundStatus,
  Role,
  ServiceAreaMode,
  Uom,
  istDateKey,
  istDayOfWeek,
} from '@freshkirana/contracts';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createTestCustomer, type TestCustomer } from '../../../testing/customer';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import {
  MockRazorpayProvider,
  PAYMENT_PROVIDER,
  RefundService,
} from '../../payment/contracts';
import type { SlotView } from '../../serviceability/contracts';

loadEnv();

const dbUp = await requireDatabase('payment.refund');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  payment?: { providerOrderId: string };
}

interface RefundView {
  id: string;
  amountPaise: number;
  status: string;
  route: string;
  reason: string;
  expectedByMinDays: number;
  expectedByMaxDays: number;
}

describe.skipIf(!dbUp)('refunds and cancellations (e2e)', () => {
  let app: INestApplication;
  let provider: MockRazorpayProvider;
  let refunds: RefundService;

  let adminToken: string;
  let vendorToken: string;
  let riderToken: string;

  let branchId: string;
  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(sellingPricePaise = 40_000): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Refund Fixture ${randomUUID()}`,
        categoryId,
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
      .post(`/branch/${branchId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId: (product.body as { id: string }).id,
        mrpPaise: sellingPricePaise,
        sellingPricePaise,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  async function place(
    who: TestCustomer,
    method: PaymentMethod,
    pricePaise = 40_000,
  ): Promise<PlacedOrder> {
    const offerId = await makeOffer(pricePaise);

    await as(who.token)(http().delete('/cart')).expect(200);
    await as(who.token)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity: 1 })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${branchId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const res = await as(who.token)(http().post('/checkout/place'))
      .send({ addressId: who.addressId, slotInstanceId: slot.id, paymentMethod: method })
      .expect(201);

    return res.body as PlacedOrder;
  }

  /** A paid prepaid order, sitting in AWAITING_VENDOR. */
  async function placePaid(who: TestCustomer, pricePaise = 40_000): Promise<PlacedOrder> {
    const order = await place(who, PaymentMethod.UPI_INTENT, pricePaise);

    const body = JSON.stringify({
      id: `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
            order_id: order.payment!.providerOrderId,
            status: 'captured',
            amount: order.grandTotalPaise,
            method: 'upi',
          },
        },
      },
    });

    await http()
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', provider.signForTesting(body))
      .send(body)
      .expect(201);

    return order;
  }

  function customerCancels(
    who: TestCustomer,
    orderId: string,
    reason = 'Changed my mind',
  ) {
    return as(who.token)(http().post(`/me/orders/${orderId}/cancel`)).send({ reason });
  }

  function vendorMoves(orderId: string, to: OrderStatus) {
    return as(vendorToken)(
      http().post(`/branch/${branchId}/orders/${orderId}/transitions`),
    ).send({ to });
  }

  async function refundsFor(who: TestCustomer, orderId: string): Promise<RefundView[]> {
    const res = await as(who.token)(http().get(`/me/orders/${orderId}/refunds`)).expect(
      200,
    );
    return res.body as RefundView[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useClass(MockRazorpayProvider)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    /*
     * Clear this suite's own debris.
     *
     * A refund never reaches COMPLETED on its own — the gateway confirms with a
     * webhook the mock has none of, which is a recorded P3.5 deferral. So every
     * previous run of this file leaves its refunds sitting in PROCESSING, and
     * the backlog eventually exceeds the sweep's own limit: the query then
     * correctly returns the *oldest* two hundred and a freshly issued refund is
     * legitimately not among them.
     *
     * Not a production concern — there the webhook completes them, and the
     * ordering added alongside this means a real backlog drains oldest first
     * rather than starving. It is a fixture problem, and it belongs here.
     */
    const db = createDatabase();
    await db.execute(
      sql`update payment.refund set status = 'COMPLETED', completed_at = now()
          where status = 'PROCESSING' and initiated_at < now() - interval '30 minutes'`,
    );

    provider = app.get<MockRazorpayProvider>(PAYMENT_PROVIDER);
    refunds = app.get(RefundService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const rider = await http()
      .post('/dev/login-as')
      .send({ role: Role.RIDER })
      .expect(201);
    riderToken = (rider.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Refund Test Traders',
        displayName: 'Refund Test Store',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    branchId = (vendor.body as { id: string }).id;

    await http()
      .patch(`/admin/branches/${branchId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await http()
      .put(`/branch/${branchId}/service-area`)
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
      .put(`/branch/${branchId}/slot-definitions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dayOfWeek: istDayOfWeek(tomorrow),
        startMinute: 600,
        endMinute: 720,
        pickingCapacityOrders: 500,
        deliveryCapacityOrders: 500,
      })
      .expect(200);

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    vendorToken = (
      await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_STAFF, branchId })
        .expect(201)
    ).body.token as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('cancelling before the store has started (§1.8.1)', () => {
    it('refunds automatically, without being asked', async () => {
      // The confirmation test's first line. A refund a customer has to ask for
      // is a refund some of them will not ask for, and the difference between
      // those two designs is money quietly kept from people owed it.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);

      const issued = await refundsFor(shopper, order.id);
      expect(issued).toHaveLength(1);
      expect(issued[0]?.amountPaise).toBe(order.grandTotalPaise);
    });

    it('sends it back the way it came', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);

      expect((await refundsFor(shopper, order.id))[0]?.route).toBe(
        RefundRoute.ORIGINAL_METHOD,
      );
    });

    it('says who cancelled, because liability differs (§1.8.4)', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);

      expect((await refundsFor(shopper, order.id))[0]?.reason).toBe(
        RefundReason.CUSTOMER_CANCELLED,
      );
    });

    it('promises a range rather than a date', async () => {
      // The gateway controls the timing and routinely takes the long end. A
      // precise date is a promise this system cannot keep, and a refund that
      // arrives late after one is a second failure on top of the first.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);

      const view = (await refundsFor(shopper, order.id))[0]!;
      expect(view.expectedByMaxDays).toBeGreaterThan(view.expectedByMinDays);
    });

    it('tells the customer without waiting to be opened', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await as(adminToken)(http().get(`/branch/${branchId}/messages`))
        .query({ limit: 100 })
        .expect(200);

      const told = (messages.body as Array<{ template: string; orderId: string }>).some(
        (m) =>
          m.orderId === order.id && m.template === NotificationTemplate.REFUND_INITIATED,
      );

      expect(told).toBe(true);
    });

    it('moves the payment to REFUNDED (§2.6.2)', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);

      const res = await as(shopper.token)(http().get(`/me/orders/${order.id}`)).expect(
        200,
      );
      expect((res.body as { paymentStatus: string }).paymentStatus).toBe(
        PaymentStatus.REFUNDED,
      );
    });

    it('refunds a cash order nothing, because nothing was taken', async () => {
      // Issuing a "refund" of money never collected would put a lie in the
      // ledger, and §2.11 makes the ledger the source of truth.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await place(shopper, PaymentMethod.COD, 20_000);

      await customerCancels(shopper, order.id).expect(201);

      expect(await refundsFor(shopper, order.id)).toHaveLength(0);
    });

    it('does not pay twice when the cancel is submitted twice', async () => {
      // Rule R4. The key is derived from the order, so "cancel order X" is one
      // intent however many times it arrives.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await customerCancels(shopper, order.id).expect(201);
      await customerCancels(shopper, order.id);

      const issued = await refundsFor(shopper, order.id);
      expect(issued).toHaveLength(1);
    });
  });

  describe('cancelling while out for delivery (§1.8.1)', () => {
    it('is refused', async () => {
      // The confirmation test's second line. A rider is holding the bag.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await vendorMoves(order.id, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(order.id, OrderStatus.PICKING).expect(201);
      await vendorMoves(order.id, OrderStatus.PACKED).expect(201);
      await vendorMoves(order.id, OrderStatus.READY_FOR_PICKUP).expect(201);
      await as(riderToken)(http().post(`/orders/${order.id}/transitions`))
        .send({ to: OrderStatus.DISPATCHED })
        .expect(201);

      await customerCancels(shopper, order.id).expect(409);
    });

    it('leaves the order dispatched, and refunds nothing', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await vendorMoves(order.id, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(order.id, OrderStatus.PICKING).expect(201);
      await vendorMoves(order.id, OrderStatus.PACKED).expect(201);
      await vendorMoves(order.id, OrderStatus.READY_FOR_PICKUP).expect(201);
      await as(riderToken)(http().post(`/orders/${order.id}/transitions`))
        .send({ to: OrderStatus.DISPATCHED })
        .expect(201);

      await customerCancels(shopper, order.id).expect(409);

      const res = await as(shopper.token)(http().get(`/me/orders/${order.id}`)).expect(
        200,
      );
      expect((res.body as { status: string }).status).toBe(OrderStatus.DISPATCHED);
      expect(await refundsFor(shopper, order.id)).toHaveLength(0);
    });

    it('still allows cancelling from PACKED, with the cost shown first', async () => {
      // §1.8.1 allows it "with a warning" — and a shopper is entitled to know
      // what it costs before they tap, not after.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await vendorMoves(order.id, OrderStatus.ACCEPTED).expect(201);
      await vendorMoves(order.id, OrderStatus.PICKING).expect(201);
      await vendorMoves(order.id, OrderStatus.PACKED).expect(201);

      const preview = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/cancellation-preview`),
      ).expect(200);

      const body = preview.body as { feePaise: number; refundPaise: number };
      // No fee in V1 (§1.8.1), and the whole amount comes back.
      expect(body.feePaise).toBe(0);
      expect(body.refundPaise).toBe(order.grandTotalPaise);

      await customerCancels(shopper, order.id).expect(201);
    });
  });

  describe('a partial refund (§1.8.2)', () => {
    it('returns only what was asked for', async () => {
      // The confirmation test's third line. A missing item is the ordinary
      // case in grocery, not an exception.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      const res = await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({
          amountPaise: 8_000,
          reason: RefundReason.ITEM_UNAVAILABLE,
          reference: `oos-${unique()}`,
          note: 'Atta was out of stock',
        })
        .expect(201);

      expect((res.body as RefundView).amountPaise).toBe(8_000);
    });

    it('leaves the payment PARTIALLY_REFUNDED, not REFUNDED', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 8_000, reference: `oos-${unique()}` })
        .expect(201);

      const view = await as(shopper.token)(http().get(`/me/orders/${order.id}`)).expect(
        200,
      );
      expect((view.body as { paymentStatus: string }).paymentStatus).toBe(
        PaymentStatus.PARTIALLY_REFUNDED,
      );
    });

    it('refuses to refund more than is left', async () => {
      // The amount comes from a picker's scale or an operator's judgement, and
      // a refund larger than the payment is a transfer.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 30_000, reference: `first-${unique()}` })
        .expect(201);

      const res = await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 30_000, reference: `second-${unique()}` })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('REFUND_EXCEEDS_REMAINING');
    });

    it('allows a second refund for a genuinely different reason', async () => {
      // Two underweight lines on one order are two refunds. A key derived from
      // the order alone would silently collapse them into one.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 5_000, reference: `line-a-${unique()}` })
        .expect(201);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 6_000, reference: `line-b-${unique()}` })
        .expect(201);

      const issued = await refundsFor(shopper, order.id);
      expect(issued).toHaveLength(2);
      expect(issued.reduce((sum, r) => sum + r.amountPaise, 0)).toBe(11_000);
    });

    it('collapses a resubmitted form into one refund', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);
      const reference = `dup-${unique()}`;

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 5_000, reference })
        .expect(201);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 5_000, reference })
        .expect(201);

      expect(await refundsFor(shopper, order.id)).toHaveLength(1);
    });

    it('refuses one on an order nobody has paid for', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await place(shopper, PaymentMethod.COD, 20_000);

      const res = await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 1_000, reference: `nope-${unique()}` })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('NOTHING_COLLECTED');
    });

    it('is not something a customer can issue to themselves', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await as(shopper.token)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 40_000, reference: `self-${unique()}` })
        .expect(403);
    });

    it('demands a reference, so a double submit cannot pay twice', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/refunds`))
        .send({ amountPaise: 1_000 })
        .expect(400);
    });
  });

  describe('what the customer can see', () => {
    it('shows the amount, the route and the wait', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);
      await customerCancels(shopper, order.id).expect(201);

      const view = (await refundsFor(shopper, order.id))[0]!;

      expect(view.amountPaise).toBe(order.grandTotalPaise);
      expect(view.status).toBe(RefundStatus.PROCESSING);
      expect(view.expectedByMinDays).toBeGreaterThan(0);
    });

    it("cannot read somebody else's refunds", async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const stranger = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);
      await customerCancels(shopper, order.id).expect(201);

      await as(stranger.token)(http().get(`/me/orders/${order.id}/refunds`)).expect(404);
    });
  });

  describe('refunds the gateway has not confirmed', () => {
    it('are findable, so somebody waiting on money is not invisible', async () => {
      // The same reasoning as the payment reconciliation sweep: a refund stuck
      // in PROCESSING looks like nothing is wrong from the inside.
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);
      await customerCancels(shopper, order.id).expect(201);

      // Everything issued in this run is younger than the cutoff, which is the
      // point: a fresh refund is not yet a problem.
      const stale = await refunds.stale(60);
      expect(stale.every((row) => row.orderId !== order.id)).toBe(true);

      const all = await refunds.stale(0);
      expect(all.some((row) => row.orderId === order.id)).toBe(true);
    });

    it('can be marked done once the gateway says so', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const order = await placePaid(shopper);
      await customerCancels(shopper, order.id).expect(201);

      const issued = (await refundsFor(shopper, order.id))[0]!;
      await refunds.markCompleted(issued.id);

      expect((await refundsFor(shopper, order.id))[0]?.status).toBe(
        RefundStatus.COMPLETED,
      );
    });
  });
});
