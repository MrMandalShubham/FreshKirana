import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CodConfirmationMethod,
  CodConfirmationStatus,
  CodRiskBand,
  CustomerReply,
  DEFAULT_COD_THRESHOLDS,
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import { InventoryService } from '../../inventory/contracts';
import { CodFlowService } from '../../order/contracts';
import type { SlotView } from '../../serviceability/contracts';
import { CodConfigService } from './cod-config.service';
import { CodConfirmationService } from './cod-confirmation.service';

loadEnv();

const dbUp = await requireDatabase('cod.cod_config');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
}

/**
 * One shopper, with their own history.
 *
 * A fresh account per test, because the score reads order history: a suite
 * sharing one customer has every test silently depending on how many orders the
 * tests before it happened to place.
 */
interface Customer {
  token: string;
  accountId: string;
  phone: string;
  addressId: string;
}

describe.skipIf(!dbUp)('COD risk and confirmation (e2e)', () => {
  let app: INestApplication;
  let config: CodConfigService;
  let confirmations: CodConfirmationService;
  let codFlow: CodFlowService;
  let inventory: InventoryService;

  let adminToken: string;
  /** The default customer, for tests that do not care about history. */
  let customer: Customer;

  let vendorId: string;
  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(sellingPricePaise = 20_000): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `COD Fixture ${randomUUID()}`,
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
        mrpPaise: sellingPricePaise,
        sellingPricePaise,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  async function placeCod(
    who: Customer,
    pricePaise = 20_000,
    quantity = 1,
  ): Promise<PlacedOrder> {
    const offerId = await makeOffer(pricePaise);

    await as(who.token)(http().delete('/cart')).expect(200);
    await as(who.token)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const res = await as(who.token)(http().post('/checkout/place'))
      .send({
        addressId: who.addressId,
        slotInstanceId: slot.id,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(201);

    return res.body as PlacedOrder;
  }

  async function newCustomer(): Promise<Customer> {
    // Digits, and unique: the address validates it as a phone number, and the
    // inbound webhook finds the order by matching what a reply came *from*.
    const phone = `+919${Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, '0')}`;

    const signIn = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone })
      .expect(201);
    const token = (signIn.body as { token: string }).token;

    const me = await as(token)(http().get('/me')).expect(200);

    const address = await as(token)(http().post('/me/addresses'))
      .send({
        label: 'HOME',
        recipientName: 'COD Tester',
        recipientPhone: phone,
        line1: '42 Some Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        ...NEARBY,
      })
      .expect(201);

    return {
      token,
      phone,
      accountId: (me.body as { accountId: string }).accountId,
      addressId: (address.body as { id: string }).id,
    };
  }

  async function statusOf(who: Customer, orderId: string): Promise<string> {
    const res = await as(who.token)(http().get(`/me/orders/${orderId}`)).expect(200);
    return (res.body as { status: string }).status;
  }

  async function messagesFor(orderId: string) {
    const res = await http()
      .get(`/vendor/${vendorId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 100 })
      .expect(200);

    return (
      res.body as Array<{
        id: string;
        providerMessageId: string | null;
        template: string;
        orderId: string | null;
        toPhone: string;
        payload: Record<string, unknown>;
      }>
    ).filter((m) => m.orderId === orderId);
  }

  /**
   * A tapped WhatsApp button, as the provider would deliver it.
   *
   * `inReplyTo` is the *provider's* message id — the handle they gave us when
   * we sent it — not our own row id. Quoting the wrong one finds no message and
   * the reply lands on no order.
   */
  async function tap(
    customer: Customer,
    reply: CustomerReply,
    inReplyToProviderId: string | null,
    messageId = `wamid-${randomUUID()}`,
  ) {
    return http()
      .post('/webhooks/whatsapp')
      .send({
        messageId,
        from: customer.phone,
        reply,
        ...(inReplyToProviderId ? { inReplyTo: inReplyToProviderId } : {}),
      })
      .expect(201);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    config = app.get(CodConfigService);
    confirmations = app.get(CodConfirmationService);
    codFlow = app.get(CodFlowService);
    inventory = app.get(InventoryService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'COD Test Traders',
        displayName: 'COD Test Store',
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

    customer = await newCustomer();

    /*
     * Clear this suite's own debris.
     *
     * `expireOverdue` is global by design — it has to be, since its whole job
     * is finding orders nobody is looking at. But every previous run of this
     * file leaves behind confirmations nobody answered, and the sweep then
     * cancels all of them: each cancellation releases stock and a slot, so 25
     * pieces of debris is a few hundred round trips through the Cloud SQL proxy
     * and the test times out at a minute.
     *
     * Not a production concern — Cloud Run reaches the database over a unix
     * socket, and the job runs every two minutes so a backlog never builds.
     * It is a local-development artifact, and it belongs in the fixture.
     */
    const db = createDatabase();
    await db.execute(
      sql`update cod.cod_confirmation
          set status = 'EXPIRED', resolved_at = now(), otp_hash = null
          where status = 'PENDING' and expires_at < now()`,
    );
  }, 180_000);

  beforeEach(async () => {
    // Every test starts from the documented defaults, so one test's threshold
    // change cannot silently decide another's band.
    await as(adminToken)(http().put('/admin/cod/thresholds'))
      .send({ ...DEFAULT_COD_THRESHOLDS, blockedPincodes: [] })
      .expect(200);
    config.invalidate();
  });

  afterAll(async () => {
    /*
     * Put the thresholds back.
     *
     * They are a single row shared by the whole database, so a suite that ends
     * with "large orders need confirming" leaves every later suite's cash order
     * held for a confirmation nobody sends — which is exactly what happened:
     * the order-state, inventory and vendor-flow suites all failed at once, on
     * code that had not changed.
     */
    await as(adminToken)(http().put('/admin/cod/thresholds'))
      .send({ ...DEFAULT_COD_THRESHOLDS, blockedPincodes: [] })
      .expect(200);

    await app?.close();
  });

  /** Puts a large order into MEDIUM without inventing a return history. */
  async function makeLargeOrdersMedium() {
    await as(adminToken)(http().put('/admin/cod/thresholds'))
      .send({ highValuePaise: 30_000, veryHighValuePaise: 40_000 })
      .expect(200);
    config.invalidate();
  }

  /** Same, for the band that wants a typed code. */
  async function makeLargeOrdersHigh() {
    await as(adminToken)(http().put('/admin/cod/thresholds'))
      .send({ highValuePaise: 30_000, veryHighValuePaise: 34_000, highScore: 35 })
      .expect(200);
    config.invalidate();
  }

  /** Messages are sent outside the request, so give them a moment to land. */
  async function askFor(orderId: string, template: string) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return (await messagesFor(orderId)).find((m) => m.template === template);
  }

  describe('a low-value order from an ordinary customer', () => {
    it('goes straight to the store', async () => {
      // The confirmation test's first line. Friction has to be earned, and a
      // new customer's small cash basket has not earned any.
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      expect(order.status).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('tells the store immediately', async () => {
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      expect(await askFor(order.id, NotificationTemplate.ORDER_NEW)).toBeDefined();
    });

    it('asks the customer for nothing', async () => {
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      expect(await confirmations.forOrder(order.id)).toBeNull();
    });
  });

  describe('an order above the threshold', () => {
    it('holds the order back from the store', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('tells the store nothing until somebody vouches for it', async () => {
      // The whole point of the part. A shop that starts packing an order that
      // will never be collected has already lost the picking time.
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      expect(await askFor(order.id, NotificationTemplate.ORDER_NEW)).toBeUndefined();
    });

    it('asks the customer, with buttons', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);

      expect(ask).toBeDefined();
      expect(ask?.toPhone).toBe(shopper.phone);
    });

    it('holds the stock while it waits', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.HELD);
    });

    it('releases it to the store when they tap yes', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);
      await tap(shopper, CustomerReply.CONFIRM, ask!.providerMessageId);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('only then tells the store', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);
      await tap(shopper, CustomerReply.CONFIRM, ask!.providerMessageId);

      expect(await askFor(order.id, NotificationTemplate.ORDER_NEW)).toBeDefined();
    });

    it('cancels it when they tap no', async () => {
      // Cheaper now than as a return three days later.
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);
      await tap(shopper, CustomerReply.DECLINE, ask!.providerMessageId);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('gives the stock back when they decline', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);
      await tap(shopper, CustomerReply.DECLINE, ask!.providerMessageId);

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.RELEASED);
    });

    it('does nothing the second time the provider delivers the tap', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);

      const messageId = `wamid-${randomUUID()}`;
      await tap(shopper, CustomerReply.CONFIRM, ask!.providerMessageId, messageId);
      const second = await tap(
        shopper,
        CustomerReply.CONFIRM,
        ask!.providerMessageId,
        messageId,
      );

      expect((second.body as { reason?: string }).reason).toBe('ALREADY_HANDLED');
      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });
  });

  describe('the band that needs a code', () => {
    it('sends a code rather than buttons', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      expect(await askFor(order.id, NotificationTemplate.COD_OTP)).toBeDefined();
      expect(await askFor(order.id, NotificationTemplate.COD_CONFIRM)).toBeUndefined();
    });

    it('refuses a tapped button, because a tap is what it does not trust', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      const res = await as(shopper.token)(
        http().post(`/me/orders/${order.id}/cod/confirm`),
      ).expect(201);

      expect((res.body as { method?: string }).method).toBe(CodConfirmationMethod.OTP);
      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('releases the order when the code is right', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const message = await askFor(order.id, NotificationTemplate.COD_OTP);
      const code = message!.payload['code'] as string;

      await as(shopper.token)(http().post(`/me/orders/${order.id}/cod/verify`))
        .send({ code })
        .expect(201);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('says how many tries are left on a wrong code', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      const res = await as(shopper.token)(
        http().post(`/me/orders/${order.id}/cod/verify`),
      )
        .send({ code: '000000' })
        .expect(201);

      const body = res.body as { ok: boolean; attemptsLeft?: number };
      expect(body.ok).toBe(false);
      expect(body.attemptsLeft).toBe(4);
    });

    it('stops accepting guesses', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      for (let i = 0; i < 5; i += 1) {
        await as(shopper.token)(http().post(`/me/orders/${order.id}/cod/verify`))
          .send({ code: '000000' })
          .expect(201);
      }

      const res = await as(shopper.token)(
        http().post(`/me/orders/${order.id}/cod/verify`),
      )
        .send({ code: '000000' })
        .expect(201);

      expect((res.body as { reason?: string }).reason).toBe('TOO_MANY_ATTEMPTS');
    });

    it('will not verify an order belonging to somebody else', async () => {
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();
      const stranger = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      await as(stranger.token)(http().post(`/me/orders/${order.id}/cod/verify`))
        .send({ code: '000000' })
        .expect(404);
    });

    it('never says the code back', async () => {
      // The code exists in the message that carried it and nowhere else.
      await makeLargeOrdersHigh();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      const res = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/cod`),
      ).expect(200);

      expect(JSON.stringify(res.body)).not.toContain('code');
    });
  });

  describe('when COD is refused outright', () => {
    async function blockThePincode() {
      await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ blockedPincodes: ['560001'] })
        .expect(200);
      config.invalidate();
    }

    it('says so at checkout, not on submit', async () => {
      // §2.10.4: "shown transparently at checkout". A payment method that
      // disappears at the last step reads as a bug rather than a decision.
      await blockThePincode();
      const shopper = await newCustomer();

      const res = await as(shopper.token)(http().get('/checkout/preview'))
        .query({ addressId: shopper.addressId })
        .expect(200);

      const cod = (res.body as { cod: { available: boolean; reasons: string[] } }).cod;
      expect(cod.available).toBe(false);
      expect(cod.reasons.join(' ')).toContain('not available');
    });

    it('refuses the order if it is attempted anyway', async () => {
      await blockThePincode();
      const shopper = await newCustomer();

      const offerId = await makeOffer(20_000);
      await as(shopper.token)(http().delete('/cart')).expect(200);
      await as(shopper.token)(http().post('/cart/items'))
        .send({ vendorOfferId: offerId, quantity: 1 })
        .expect(201);

      const slots = await http()
        .get(`/serviceability/stores/${vendorId}/slots`)
        .query({ days: 3 })
        .expect(200);
      const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

      const res = await as(shopper.token)(http().post('/checkout/place'))
        .send({
          addressId: shopper.addressId,
          slotInstanceId: slot.id,
          paymentMethod: PaymentMethod.COD,
        })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('COD_NOT_AVAILABLE');
    });

    it('stays blocked however good the customer is', async () => {
      // A blocked pincode is a property of where the order is going, not of who
      // is buying — no amount of good history makes an area deliverable.
      await blockThePincode();
      const shopper = await newCustomer();

      const assessment = await codFlow.assess({
        accountId: shopper.accountId,
        orderTotalPaise: 1_000,
        addressPincode: '560001',
        paymentMethod: PaymentMethod.COD,
      });

      expect(assessment.band).toBe(CodRiskBand.BLOCKED);
    });

    it('leaves prepaid alone', async () => {
      // Nothing to collect, so none of this applies.
      await blockThePincode();
      const shopper = await newCustomer();

      const assessment = await codFlow.assess({
        accountId: shopper.accountId,
        orderTotalPaise: 500_000,
        addressPincode: '560001',
        paymentMethod: PaymentMethod.UPI_INTENT,
      });

      expect(assessment.allowed).toBe(true);
      expect(assessment.method).toBe(CodConfirmationMethod.NONE);
    });
  });

  describe('changing the rules without a deploy (§2.10.4)', () => {
    it('changes behaviour on the very next order', async () => {
      // The confirmation test's third line, and the reason these live in a
      // table rather than an environment variable: on Cloud Run an env var
      // lives in the revision, so changing one *is* a deploy.
      const before = await placeCod(await newCustomer(), 35_000);
      expect(before.status).toBe(OrderStatus.AWAITING_VENDOR);

      await makeLargeOrdersMedium();

      const after = await placeCod(await newCustomer(), 35_000);
      expect(after.status).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('refuses cutoffs that would make a band unreachable', async () => {
      const res = await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ mediumScore: 80, highScore: 40 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('INVALID_COD_THRESHOLDS');
    });

    it('leaves the old thresholds in force when an edit is refused', async () => {
      await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ mediumScore: 80, highScore: 40 })
        .expect(400);
      config.invalidate();

      const current = await config.current();
      expect(current.mediumScore).toBe(DEFAULT_COD_THRESHOLDS.mediumScore);
    });

    it('takes a patch, not the whole object', async () => {
      // An operator tightening one number should not have to restate the other
      // seven — a form that resubmits stale values for untouched fields is how
      // one change silently reverts another.
      await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ rtoBlockCount: 2 })
        .expect(200);

      const res = await as(adminToken)(http().get('/admin/cod/thresholds')).expect(200);
      const body = res.body as {
        rtoBlockCount: number;
        confirmationWindowMinutes: number;
        blockedPincodes: string[];
      };

      expect(body.rtoBlockCount).toBe(2);
      expect(body.confirmationWindowMinutes).toBe(
        DEFAULT_COD_THRESHOLDS.confirmationWindowMinutes,
      );
      expect(body.blockedPincodes).toEqual([]);
    });

    it('is not something a customer can do', async () => {
      await as(customer.token)(http().put('/admin/cod/thresholds'))
        .send({ rtoBlockCount: 99 })
        .expect(403);
    });
  });

  describe('the audit log (§2.10.4, §3.8)', () => {
    it('records every decision, including the ones that sailed through', async () => {
      // A log of refusals answers "why was I blocked?" but not "are these
      // thresholds right?", and the second decides whether COD is profitable.
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      const res = await as(adminToken)(
        http().get(`/admin/cod/decisions/order/${order.id}`),
      ).expect(200);

      const decision = res.body as { band: string; reasons: string[] };
      expect(decision.band).toBe(CodRiskBand.LOW);
      expect(decision.reasons.length).toBeGreaterThan(0);
    });

    it('says which rules fired, in words a person can read', async () => {
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      const res = await as(adminToken)(
        http().get(`/admin/cod/decisions/order/${order.id}`),
      ).expect(200);

      expect((res.body as { reasons: string[] }).reasons.join(' ')).toContain(
        'First order',
      );
    });

    it('snapshots the thresholds, so an old decision still explains itself', async () => {
      // They change without a deploy, so a decision read six weeks later cannot
      // be explained by the config as it stands today.
      await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ highValuePaise: 111_100 })
        .expect(200);
      config.invalidate();

      const order = await placeCod(await newCustomer(), 20_000);

      await as(adminToken)(http().put('/admin/cod/thresholds'))
        .send({ highValuePaise: 300_000 })
        .expect(200);
      config.invalidate();

      const res = await as(adminToken)(
        http().get(`/admin/cod/decisions/order/${order.id}`),
      ).expect(200);

      const thresholds = (res.body as { thresholds: { highValuePaise: number } })
        .thresholds;
      expect(thresholds.highValuePaise).toBe(111_100);
    });

    it('records what the decision was made about, so a score can be recomputed', async () => {
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      const res = await as(adminToken)(
        http().get(`/admin/cod/decisions/order/${order.id}`),
      ).expect(200);

      const inputs = (res.body as { inputs: { orderTotalPaise: number } }).inputs;
      expect(inputs.orderTotalPaise).toBe(order.grandTotalPaise);
    });

    it('is not readable by the customer it is about', async () => {
      const shopper = await newCustomer();
      const order = await placeCod(shopper, 20_000);

      await as(shopper.token)(
        http().get(`/admin/cod/decisions/order/${order.id}`),
      ).expect(403);
    });
  });

  describe('an operator deciding for the customer', () => {
    it('releases a held order, and says who did it', async () => {
      // The rules will sometimes be wrong about a real person. The alternative
      // to an audited override is an unaudited one.
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/cod/confirm`))
        .send({ note: 'Regular customer, called the shop to vouch' })
        .expect(201);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.AWAITING_VENDOR);

      const record = await confirmations.forOrder(order.id);
      expect(record?.status).toBe(CodConfirmationStatus.OVERRIDDEN);
      expect(record?.resolvedBy).not.toBeNull();
      expect(record?.resolutionNote).toContain('Regular customer');
    });

    it('demands a reason', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      await as(adminToken)(http().post(`/admin/orders/${order.id}/cod/confirm`))
        .send({})
        .expect(400);
    });

    it('is not something a customer can do to their own order', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);

      await as(shopper.token)(http().post(`/admin/orders/${order.id}/cod/confirm`))
        .send({ note: 'let me through' })
        .expect(403);
    });
  });

  describe('when nobody answers', () => {
    async function ageConfirmation(orderId: string) {
      const db = createDatabase();
      await db.execute(
        sql`update cod.cod_confirmation set expires_at = now() - interval '1 minute' where order_id = ${orderId}`,
      );
    }

    it('cancels the order once the window closes', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      await ageConfirmation(order.id);

      const result = await codFlow.expireOverdue();
      expect(result.cancelled).toBeGreaterThan(0);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('gives the stock back', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      await ageConfirmation(order.id);

      await codFlow.expireOverdue();

      const held = await inventory.forOrder(order.id);
      expect(held[0]?.status).toBe(ReservationStatus.RELEASED);
    });

    it('marks the ceremony expired rather than deleting it', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      await ageConfirmation(order.id);

      await codFlow.expireOverdue();

      const record = await confirmations.forOrder(order.id);
      expect(record?.status).toBe(CodConfirmationStatus.EXPIRED);
    });

    it('is safe to run twice', async () => {
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      await ageConfirmation(order.id);

      await codFlow.expireOverdue();
      const second = await codFlow.expireOverdue();

      expect(second.failed).toBe(0);
      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('ignores a tapped button that arrives too late', async () => {
      // Their button was stale. That is not their mistake, and it must not
      // resurrect an order whose stock has already gone back.
      await makeLargeOrdersMedium();
      const shopper = await newCustomer();

      const order = await placeCod(shopper, 35_000);
      const ask = await askFor(order.id, NotificationTemplate.COD_CONFIRM);

      await ageConfirmation(order.id);
      await codFlow.expireOverdue();

      await tap(shopper, CustomerReply.CONFIRM, ask!.providerMessageId);

      expect(await statusOf(shopper, order.id)).toBe(OrderStatus.CANCELLED);
    });
  });
});
