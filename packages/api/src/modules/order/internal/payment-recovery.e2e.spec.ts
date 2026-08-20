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
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import { InventoryService } from '../../inventory/contracts';
import { PaymentService } from '../../payment/contracts';
import { MockRazorpayProvider, PAYMENT_PROVIDER } from '../../payment/contracts';
import type { SlotView } from '../../serviceability/contracts';
import { PaymentFlowService } from './payment-flow.service';
import { PaymentRecoveryService } from './payment-recovery.service';

loadEnv();

const dbUp = await requireDatabase('payment.payment');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  codCollectablePaise: number;
  paymentMethod: string;
  payment?: { providerOrderId: string; amountPaise: number };
}

describe.skipIf(!dbUp)('payment recovery (e2e)', () => {
  let app: INestApplication;
  let provider: MockRazorpayProvider;
  let payments: PaymentService;
  let recovery: PaymentRecoveryService;
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
        name: `Recovery Fixture ${randomUUID()}`,
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
        mrpPaise: 40_000,
        sellingPricePaise: 40_000,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

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

  /** A signed webhook in the gateway's envelope. */
  function webhook(
    event: 'payment.captured' | 'payment.failed',
    providerOrderId: string,
  ) {
    const body = JSON.stringify({
      id: `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      event,
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
            order_id: providerOrderId,
            status: event === 'payment.captured' ? 'captured' : 'failed',
            amount: 40_500,
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

  function post(body: string, signature: string) {
    return http()
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(body);
  }

  async function statusOf(orderId: string): Promise<string> {
    const res = await as(customerToken)(http().get(`/me/orders/${orderId}`)).expect(200);
    return (res.body as { status: string }).status;
  }

  /** Fails the current attempt, as the gateway would. */
  async function failPayment(order: PlacedOrder) {
    const { body, signature } = webhook('payment.failed', order.payment!.providerOrderId);
    await post(body, signature).expect(201);
  }

  beforeAll(async () => {
    // Pinned to the mock: the module picks the live gateway whenever
    // RAZORPAY_KEY_ID is set, and a test must not depend on a developer's .env.
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

    provider = app.get<MockRazorpayProvider>(PAYMENT_PROVIDER);
    payments = app.get(PaymentService);
    recovery = app.get(PaymentRecoveryService);
    flow = app.get(PaymentFlowService);
    inventory = app.get(InventoryService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const customer = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: `+9192${randomUUID().slice(0, 8)}` })
      .expect(201);
    customerToken = (customer.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Recovery Test Traders',
        displayName: 'Recovery Test Store',
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
        recipientName: 'Recovery Tester',
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

  describe('a failed payment is not a lost order (§2.10.3)', () => {
    it('keeps the order waiting rather than cancelling it', async () => {
      // A declined UPI payment is somebody who tried to pay and was told no by
      // a bank — not somebody who changed their mind. Cancelling on them turns
      // a recoverable moment into a lost order.
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);

      expect(await statusOf(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('keeps the stock and the slot held', async () => {
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);
      await failPayment(order);

      const held = await inventory.forOrder(order.id);
      expect(held).toHaveLength(1);
      expect(held[0]?.status).toBe(ReservationStatus.HELD);
    });

    it('sends the link to their phone', async () => {
      // The common failure is a shopper who switched to their bank's app, hit
      // a problem, and never came back to the browser tab.
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await http()
        .get(`/vendor/${vendorId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 100 })
        .expect(200);

      const link = (
        messages.body as Array<{
          template: string;
          orderId: string;
          payload: { payUrl?: string };
        }>
      ).find(
        (m) => m.orderId === order.id && m.template === NotificationTemplate.PAYMENT_LINK,
      );

      expect(link).toBeDefined();

      // A tappable URL, not a bare token: a WhatsApp template substitutes one
      // variable, and nobody assembles a link out of a base URL they were
      // never sent.
      const latest = await payments.latestAttempt(order.id);
      expect(link?.payload.payUrl).toContain(`/pay/${latest!.recoveryToken}`);
    });
  });

  describe('trying again (§2.10.3 step 1)', () => {
    it('offers a fresh intent on the same order', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);

      const res = await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/retry`),
      ).expect(201);

      const intent = res.body as { providerOrderId: string; amountPaise: number };

      expect(intent.providerOrderId).not.toBe(order.payment!.providerOrderId);
      expect(intent.amountPaise).toBe(order.grandTotalPaise);
    });

    it('creates no second order', async () => {
      // The confirmation test's own words. The stock and slot are still held
      // from the first attempt; this is a new payment, not a new order.
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);
      await as(customerToken)(http().post(`/me/orders/${order.id}/payment/retry`)).expect(
        201,
      );

      const history = await as(customerToken)(http().get('/me/orders')).expect(200);
      const matching = (history.body as PlacedOrder[]).filter(
        (o) => o.orderNumber === order.orderNumber,
      );

      expect(matching).toHaveLength(1);
    });

    it('completes the same order when the retry is paid', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);

      const res = await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/retry`),
      ).expect(201);
      const retry = res.body as { providerOrderId: string };

      const captured = webhook('payment.captured', retry.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('refuses a second attempt while the first is still live', async () => {
      // Two open intents for one order means the customer can pay twice, and
      // no amount of reconciliation afterwards makes that a good experience.
      const order = await placePrepaid(await makeOffer());

      const res = await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/retry`),
      ).expect(409);

      expect(JSON.stringify(res.body)).toContain('PAYMENT_STILL_OPEN');
    });

    it('refuses once the order has moved on', async () => {
      const order = await placePrepaid(await makeOffer());
      const captured = webhook('payment.captured', order.payment!.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      await as(customerToken)(http().post(`/me/orders/${order.id}/payment/retry`)).expect(
        409,
      );
    });
  });

  describe('the payment link (§2.10.3 step 2)', () => {
    it('lets somebody finish paying without signing in', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);
      await as(customerToken)(http().post(`/me/orders/${order.id}/payment/retry`)).expect(
        201,
      );

      const latest = await payments.latestAttempt(order.id);

      // No Authorization header: this arrives from a WhatsApp message, and the
      // device that opens it may not be signed in.
      const res = await http().get(`/pay/${latest!.recoveryToken}`).expect(200);
      const body = res.body as { usable: boolean; amountPaise: number };

      expect(body.usable).toBe(true);
      expect(body.amountPaise).toBe(order.grandTotalPaise);
    });

    it('says nothing about the customer', async () => {
      // A bearer token in a message anyone could forward. It buys the ability
      // to pay, not to read somebody's order.
      const order = await placePrepaid(await makeOffer());
      const latest = await payments.latestAttempt(order.id);

      const res = await http().get(`/pay/${latest!.recoveryToken}`).expect(200);
      const serialised = JSON.stringify(res.body);

      expect(serialised).not.toContain('Recovery Tester');
      expect(serialised).not.toContain('+919812345678');
      expect(serialised).not.toContain('42 Some Street');
    });

    it('answers the same way for an unknown token as an expired one', async () => {
      // Distinguishing them lets somebody probe for live tokens.
      const res = await http().get(`/pay/${randomUUID()}`).expect(200);
      expect((res.body as { usable: boolean }).usable).toBe(false);
    });

    it('stops working once the payment is captured', async () => {
      const order = await placePrepaid(await makeOffer());
      const latest = await payments.latestAttempt(order.id);

      const captured = webhook('payment.captured', order.payment!.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      const res = await http().get(`/pay/${latest!.recoveryToken}`).expect(200);
      expect((res.body as { usable: boolean }).usable).toBe(false);
    });

    it('revokes the old link when a new attempt supersedes it', async () => {
      // A shopper with two WhatsApp messages must not be able to open the
      // wrong one and pay against a dead attempt.
      const order = await placePrepaid(await makeOffer());
      const first = await payments.latestAttempt(order.id);

      await failPayment(order);
      await as(customerToken)(http().post(`/me/orders/${order.id}/payment/retry`)).expect(
        201,
      );

      const res = await http().get(`/pay/${first!.recoveryToken}`).expect(200);
      expect((res.body as { usable: boolean }).usable).toBe(false);
    });
  });

  describe('taking cash instead (§2.10.3 step 3)', () => {
    it('turns a failed payment into a live order', async () => {
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);
      await failPayment(order);

      const res = await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/convert-to-cod`),
      ).expect(201);

      const converted = res.body as PlacedOrder;

      expect(converted.status).toBe(OrderStatus.AWAITING_VENDOR);
      expect(converted.paymentMethod).toBe(PaymentMethod.COD);
      // The rider now collects what the gateway did not.
      expect(converted.codCollectablePaise).toBe(order.grandTotalPaise);
    });

    it('settles the stock that was only held', async () => {
      const offerId = await makeOffer(5);
      const order = await placePrepaid(offerId, 2);
      await failPayment(order);

      await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/convert-to-cod`),
      ).expect(201);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.CONFIRMED);
      expect(held[0]?.expiresAt).toBeNull();
    });

    it('kills the open payment, so nobody pays twice', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);
      const before = await payments.latestAttempt(order.id);

      await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/convert-to-cod`),
      ).expect(201);

      const res = await http().get(`/pay/${before!.recoveryToken}`).expect(200);
      expect((res.body as { usable: boolean }).usable).toBe(false);
    });

    it('tells the store, which had heard nothing until now', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);
      await as(customerToken)(
        http().post(`/me/orders/${order.id}/payment/convert-to-cod`),
      ).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('says what the order can still do, before offering a button', async () => {
      const order = await placePrepaid(await makeOffer());
      await failPayment(order);

      const res = await as(customerToken)(
        http().get(`/me/orders/${order.id}/payment/recovery`),
      ).expect(200);

      const offer = res.body as { canRetry: boolean; canConvertToCod: boolean };
      expect(offer.canRetry).toBe(true);
      expect(offer.canConvertToCod).toBe(true);
    });

    it('offers nothing once the order has moved on', async () => {
      const order = await placePrepaid(await makeOffer());
      const captured = webhook('payment.captured', order.payment!.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      const res = await as(customerToken)(
        http().get(`/me/orders/${order.id}/payment/recovery`),
      ).expect(200);

      expect(res.body).toEqual({ canRetry: false, canConvertToCod: false });
    });

    it("refuses somebody else's order", async () => {
      const order = await placePrepaid(await makeOffer());
      const other = await http()
        .post('/dev/login-as')
        .send({ role: Role.CUSTOMER, phone: `+9191${randomUUID().slice(0, 8)}` })
        .expect(201);

      await as((other.body as { token: string }).token)(
        http().post(`/me/orders/${order.id}/payment/convert-to-cod`),
      ).expect(404);
    });
  });

  describe('when nobody comes back (§2.10.3 step 4)', () => {
    /** Ages an attempt past its window, as ten minutes of waiting would. */
    async function expirePaymentWindow(orderId: string) {
      const latest = await payments.latestAttempt(orderId);
      const db = createDatabase();
      await db.execute(
        sql`update payment.payment set expires_at = now() - interval '1 minute' where id = ${latest!.id}`,
      );
    }

    it('cancels the order once the window closes', async () => {
      const order = await placePrepaid(await makeOffer());
      await expirePaymentWindow(order.id);

      const result = await recovery.cancelExpired();
      expect(result.cancelled).toBeGreaterThan(0);

      expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('gives the stock back', async () => {
      const offerId = await makeOffer(4);
      const order = await placePrepaid(offerId, 2);
      await expirePaymentWindow(order.id);

      await recovery.cancelExpired();

      const stock = await http()
        .get(`/vendor/${vendorId}/offers/${offerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((stock.body as { stockReserved: number }).stockReserved).toBe(0);
    });

    it('leaves a paid order alone, however old its attempt', async () => {
      const order = await placePrepaid(await makeOffer());
      const captured = webhook('payment.captured', order.payment!.providerOrderId);
      await post(captured.body, captured.signature).expect(201);

      await expirePaymentWindow(order.id).catch(() => undefined);
      await recovery.cancelExpired();

      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('is safe to run twice', async () => {
      const order = await placePrepaid(await makeOffer());
      await expirePaymentWindow(order.id);

      await recovery.cancelExpired();
      const second = await recovery.cancelExpired();

      expect(second.failed).toBe(0);
      expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('runs as part of the reconciliation sweep', async () => {
      // Recovering a lost webhook and closing an abandoned checkout are the
      // same question — what actually happened to the money?
      const order = await placePrepaid(await makeOffer());
      await expirePaymentWindow(order.id);

      const result = await flow.reconcilePending(0);
      expect(result.cancelled).toBeGreaterThan(0);

      expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('marks the attempt dead, so its link stops working', async () => {
      const order = await placePrepaid(await makeOffer());
      const latest = await payments.latestAttempt(order.id);
      await expirePaymentWindow(order.id);

      await recovery.cancelExpired();

      const res = await http().get(`/pay/${latest!.recoveryToken}`).expect(200);
      expect((res.body as { usable: boolean }).usable).toBe(false);

      const after = await payments.latestAttempt(order.id);
      expect(after?.status).toBe(PaymentStatus.FAILED);
    });
  });
});
