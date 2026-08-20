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
  ReservationStatus,
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
import { InventoryService } from '../../inventory/contracts';
import { PaymentFlowService } from '../../order/contracts';
import type { SlotView } from '../../serviceability/contracts';
import { PaymentService } from './payment.service';
import { MockRazorpayProvider, PAYMENT_PROVIDER } from './razorpay.provider';

loadEnv();

const dbUp = await requireDatabase('payment.payment');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  payment?: { providerOrderId: string; amountPaise: number; paymentId: string };
}

describe.skipIf(!dbUp)('payment (e2e)', () => {
  let app: INestApplication;
  let provider: MockRazorpayProvider;
  let payments: PaymentService;
  let flow: PaymentFlowService;
  let inventory: InventoryService;

  let adminToken: string;
  let customerToken: string;

  let vendorId: string;
  let categoryId: string;
  let addressId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(stockOnHand = 50): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Payment Fixture ${randomUUID()}`,
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
      .post(`/vendor/${vendorId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId: (product.body as { id: string }).id,
        mrpPaise: 60_000,
        sellingPricePaise: 60_000,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  /** Places a UPI order and returns it with its payment intent. */
  async function placePrepaid(offerId: string, quantity = 1): Promise<PlacedOrder> {
    await as(customerToken)(http().delete('/cart')).expect(200);
    await as(customerToken)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const res = await as(customerToken)(http().post('/checkout/place'))
      .send({
        addressId,
        slotInstanceId: slot.id,
        paymentMethod: PaymentMethod.UPI_INTENT,
      })
      .expect(201);

    return res.body as PlacedOrder;
  }

  /** A webhook body in the gateway's own envelope, correctly signed. */
  function webhook(
    event: 'payment.captured' | 'payment.failed',
    providerOrderId: string,
    options: { eventId?: string; amountPaise?: number } = {},
  ) {
    const body = JSON.stringify({
      id: options.eventId ?? `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      event,
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
            order_id: providerOrderId,
            status: event === 'payment.captured' ? 'captured' : 'failed',
            amount: options.amountPaise ?? 60_500,
            method: 'upi',
            ...(event === 'payment.failed'
              ? { error_description: 'Payment declined by the bank' }
              : {}),
          },
        },
      },
    });

    return { body, signature: provider.signForTesting(body) };
  }

  function post(body: string, signature?: string) {
    const req = http().post('/webhooks/razorpay').set('content-type', 'application/json');

    if (signature) req.set('x-razorpay-signature', signature);
    return req.send(body);
  }

  async function statusOf(orderId: string): Promise<string> {
    const res = await as(customerToken)(http().get(`/me/orders/${orderId}`)).expect(200);
    return (res.body as { status: string }).status;
  }

  beforeAll(async () => {
    // Pinned to the mock, not left to whatever the environment happens to hold.
    // The module picks the live gateway whenever RAZORPAY_KEY_ID is set, so a
    // developer with credentials in their .env would otherwise have these tests
    // making real calls to Razorpay — which is how this suite first failed.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useClass(MockRazorpayProvider)
      .compile();

    // The webhook signature is computed over the raw request bytes, so the test
    // application must capture them exactly as production does.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // The same instance the service uses, so signing and verifying agree.
    provider = app.get<MockRazorpayProvider>(PAYMENT_PROVIDER);
    payments = app.get(PaymentService);
    flow = app.get(PaymentFlowService);
    inventory = app.get(InventoryService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const customer = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: `+9193${randomUUID().slice(0, 8)}` })
      .expect(201);
    customerToken = (customer.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Payment Test Traders',
        displayName: 'Payment Test Store',
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
        pickingCapacityOrders: 200,
        deliveryCapacityOrders: 200,
      })
      .expect(200);

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const address = await as(customerToken)(http().post('/me/addresses'))
      .send({
        label: 'HOME',
        recipientName: 'Payment Tester',
        recipientPhone: '+919812345678',
        line1: '42 Some Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        ...NEARBY,
      })
      .expect(201);
    addressId = (address.body as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('placing a prepaid order', () => {
    it('waits for the money before telling the store', async () => {
      // A store that starts packing before the payment lands eats the loss when
      // it fails. Prepaid sits in PENDING_PAYMENT until the gateway confirms.
      const order = await placePrepaid(await makeOffer());

      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('hands back something the customer can actually pay', async () => {
      const order = await placePrepaid(await makeOffer());

      expect(order.payment?.providerOrderId).toMatch(/^order_/);
      expect(order.payment?.amountPaise).toBeGreaterThan(0);
    });

    it('holds the stock without confirming it', async () => {
      // Held, not confirmed: the §2.5 sweeper must be able to take it back if
      // the customer never pays.
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);

      const held = await inventory.forOrder(order.id);
      expect(held).toHaveLength(1);
      expect(held[0]?.status).toBe(ReservationStatus.HELD);
      expect(held[0]?.expiresAt).not.toBeNull();
    });

    it('refuses a method nothing downstream can service', async () => {
      const offerId = await makeOffer();
      await as(customerToken)(http().delete('/cart')).expect(200);
      await as(customerToken)(http().post('/cart/items'))
        .send({ vendorOfferId: offerId, quantity: 1 })
        .expect(201);

      const slots = await http()
        .get(`/serviceability/stores/${vendorId}/slots`)
        .query({ days: 3 })
        .expect(200);
      const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

      await as(customerToken)(http().post('/checkout/place'))
        .send({
          addressId,
          slotInstanceId: slot.id,
          paymentMethod: PaymentMethod.CARD,
        })
        .expect(400);
    });
  });

  describe('the money arrives', () => {
    it('confirms the order and the stock', async () => {
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);

      const { body, signature } = webhook(
        'payment.captured',
        order.payment!.providerOrderId,
      );
      const res = await post(body, signature).expect(201);

      expect((res.body as { reason: string }).reason).toBe('ORDER_CONFIRMED');
      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.CONFIRMED);
      expect(held[0]?.expiresAt).toBeNull();
    });

    it('tells the store, which has heard nothing until now', async () => {
      // P3.2 moved the announcement from checkout to capture and never landed
      // it here, so a paid order reached AWAITING_VENDOR with no shop told.
      // The SLA sweep hid it: the store got a *reminder* for an order they had
      // never heard of, and a breach then cancelled it. Fixed in P3.4.
      const order = await placePrepaid(await makeOffer());

      const { body, signature } = webhook(
        'payment.captured',
        order.payment!.providerOrderId,
      );
      await post(body, signature).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await http()
        .get(`/vendor/${vendorId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 100 })
        .expect(200);

      const told = (messages.body as Array<{ template: string; orderId: string }>).some(
        (m) => m.orderId === order.id && m.template === NotificationTemplate.ORDER_NEW,
      );

      expect(told).toBe(true);
    });

    it('records the capture against the payment', async () => {
      const order = await placePrepaid(await makeOffer());
      const { body, signature } = webhook(
        'payment.captured',
        order.payment!.providerOrderId,
      );
      await post(body, signature).expect(201);

      const rows = await payments.forOrder(order.id);
      expect(rows[0]?.status).toBe(PaymentStatus.CAPTURED);
      expect(rows[0]?.providerPaymentId).toMatch(/^pay_/);
      expect(rows[0]?.capturedAt).not.toBeNull();
    });
  });

  describe('the money does not arrive', () => {
    it('holds the order open rather than cancelling it', async () => {
      // Changed deliberately in P3.3: a declined payment is not somebody
      // changing their mind, and cancelling on them loses a recoverable order.
      // The stock stays held so there is still an order to recover — the
      // §2.10.3 sweeper is what eventually takes it back.
      const offerId = await makeOffer(4);
      const order = await placePrepaid(offerId, 2);

      const { body, signature } = webhook(
        'payment.failed',
        order.payment!.providerOrderId,
      );
      await post(body, signature).expect(201);

      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);

      const stock = await http()
        .get(`/vendor/${vendorId}/offers/${offerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((stock.body as { stockReserved: number }).stockReserved).toBe(2);
    });

    it('never lets a late failure undo a capture', async () => {
      // Gateways send events out of order. A "failed" arriving after a capture
      // must not cancel an order the customer has paid for.
      const order = await placePrepaid(await makeOffer());
      const captured = webhook('payment.captured', order.payment!.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      const failed = webhook('payment.failed', order.payment!.providerOrderId);
      const res = await post(failed.body, failed.signature).expect(201);

      expect((res.body as { reason: string }).reason).toBe('ALREADY_SETTLED');
      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });
  });

  describe('what the webhook refuses', () => {
    it('rejects an unsigned body', async () => {
      const order = await placePrepaid(await makeOffer());
      const { body } = webhook('payment.captured', order.payment!.providerOrderId);

      const res = await post(body).expect(201);

      expect((res.body as { reason: string }).reason).toBe('INVALID_SIGNATURE');
      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('rejects a body signed with the wrong secret', async () => {
      const order = await placePrepaid(await makeOffer());
      const { body } = webhook('payment.captured', order.payment!.providerOrderId);

      const res = await post(body, 'deadbeef'.repeat(8)).expect(201);

      expect((res.body as { reason: string }).reason).toBe('INVALID_SIGNATURE');
      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('rejects a tampered body whose signature was valid for the original', async () => {
      // The whole point of signing: an attacker who replays a real capture
      // against a *different* order must fail.
      const first = await placePrepaid(await makeOffer());
      const second = await placePrepaid(await makeOffer());

      const { body, signature } = webhook(
        'payment.captured',
        first.payment!.providerOrderId,
      );
      const tampered = body.replace(
        first.payment!.providerOrderId,
        second.payment!.providerOrderId,
      );

      const res = await post(tampered, signature).expect(201);

      expect((res.body as { reason: string }).reason).toBe('INVALID_SIGNATURE');
      expect(await statusOf(second.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('does nothing the second time the gateway delivers an event', async () => {
      const order = await placePrepaid(await makeOffer());
      const eventId = `evt_replay_${randomUUID().slice(0, 8)}`;

      const first = webhook('payment.captured', order.payment!.providerOrderId, {
        eventId,
      });
      await post(first.body, first.signature).expect(201);

      const replay = webhook('payment.captured', order.payment!.providerOrderId, {
        eventId,
      });
      const res = await post(replay.body, replay.signature).expect(201);

      expect((res.body as { reason: string }).reason).toBe('ALREADY_APPLIED');
      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('records an event for a payment it does not recognise, and acts on nothing', async () => {
      const { body, signature } = webhook('payment.captured', 'order_mocknothinghere');
      const res = await post(body, signature).expect(201);

      expect((res.body as { reason: string }).reason).toBe('NO_MATCHING_PAYMENT');
    });

    it('needs no login — the caller is a gateway, not a person', async () => {
      await post('{"nonsense":true}', 'whatever').expect(201);
    });
  });

  describe('when the webhook never comes (§2.10.3)', () => {
    it('finds the payment by asking the gateway', async () => {
      // The customer paid and the webhook was lost. Without this the order sits
      // in PENDING_PAYMENT while their money is gone — silent, and the worst
      // failure this system has.
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);

      provider.pretendCustomerPaid(order.payment!.providerOrderId);

      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);

      const result = await flow.reconcilePending(0);
      expect(result.recovered).toBeGreaterThan(0);

      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('marks how the payment was recovered, so the gap is countable', async () => {
      const order = await placePrepaid(await makeOffer());
      provider.pretendCustomerPaid(order.payment!.providerOrderId);

      await flow.reconcilePending(0);

      const [row] = await payments.forOrder(order.id);
      const events = await payments.eventsFor(row!.id);

      expect(events.some((e) => e.source === 'RECONCILIATION')).toBe(true);
    });

    it('is safe to run twice', async () => {
      const order = await placePrepaid(await makeOffer());
      provider.pretendCustomerPaid(order.payment!.providerOrderId);

      await flow.reconcilePending(0);
      const second = await flow.reconcilePending(0);

      expect(second.failed).toBe(0);
      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('leaves a genuinely unpaid order alone', async () => {
      const order = await placePrepaid(await makeOffer());

      await flow.reconcilePending(0);

      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('is reachable by ops, and closed to everyone else', async () => {
      await as(adminToken)(http().post('/internal/payments/reconcile')).expect(201);
      await as(customerToken)(http().post('/internal/payments/reconcile')).expect(403);
      await http().post('/internal/payments/reconcile').expect(401);
    });
  });

  describe('the database constraints', () => {
    it('refuses two payments for one order', async () => {
      const db = createDatabase();
      const key = `order:${randomUUID()}`;

      const insert = () => `
        insert into payment.payment
          (order_id, account_id, provider, amount_paise, idempotency_key)
        values ('${randomUUID()}', '${randomUUID()}', 'razorpay-mock', 1000, '${key}')
      `;

      await db.execute(insert());
      await expect(db.execute(insert())).rejects.toThrow(/payment_idempotency_key/);
    });

    it('refuses the same gateway event twice', async () => {
      const db = createDatabase();
      const eventId = `evt_${randomUUID()}`;

      const insert = () => `
        insert into payment.payment_event
          (provider, provider_event_id, status)
        values ('razorpay-mock', '${eventId}', 'CAPTURED')
      `;

      await db.execute(insert());
      await expect(db.execute(insert())).rejects.toThrow(/payment_event_provider_key/);
    });
  });
});
