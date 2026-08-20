import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  MessageStatus,
  NotificationTemplate,
  OrderStatus,
  ProductStatus,
  Role,
  ServiceAreaMode,
  Uom,
  VendorReply,
  istDateKey,
  istDayOfWeek,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { createTestCustomer } from '../../../testing/customer';
import { requireDatabase } from '../../../testing/database';
import type { SlotView } from '../../serviceability/contracts';
import { VendorOrderFlowService } from './vendor-order-flow.service';

loadEnv();

const dbUp = await requireDatabase('notification.message');

/** Its own patch of the map for this run — see the serviceability suite. */
const STORE = {
  latitude: 8 + Math.random() * 9,
  longitude: 70 + Math.random() * 14,
};
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface MessageRow {
  id: string;
  template: string;
  toPhone: string;
  status: string;
  providerMessageId: string | null;
  orderId: string | null;
  payload: Record<string, unknown>;
}

describe.skipIf(!dbUp)('vendor WhatsApp flow (e2e)', () => {
  let app: INestApplication;
  let flow: VendorOrderFlowService;

  let adminToken: string;
  let customerToken: string;

  let vendorId: string;
  let vendorPhone: string;
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

  /**
   * Each order comes from a shopper with no history (P3.4).
   *
   * Placement now reads the account's past: §2.10.4 holds a cash order from
   * somebody with returned deliveries rather than sending it to the store. This
   * suite manufactures exactly that history on purpose, so reusing one customer
   * meant later orders were placed by a high-risk account and stopped behaving
   * like the ordinary ones these tests describe.
   *
   * The suite-level handles are repointed rather than returned, so every
   * existing call site keeps reading the order it just placed.
   */
  async function placeOrder(): Promise<{ id: string; orderNumber: string }> {
    const shopper = await createTestCustomer(app, NEARBY);
    customerToken = shopper.token;
    addressId = shopper.addressId;

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

    return res.body as { id: string; orderNumber: string };
  }

  /** What the store was sent about this order, newest first. */
  async function messagesFor(orderId: string): Promise<MessageRow[]> {
    const res = await as(adminToken)(http().get(`/vendor/${vendorId}/messages`))
      .query({ limit: 100 })
      .expect(200);

    return (res.body as MessageRow[]).filter((m) => m.orderId === orderId);
  }

  /** The store taps a button. This is what the provider would post. */
  function tap(reply: VendorReply, inReplyTo: string | null, messageId = randomUUID()) {
    return http()
      .post('/webhooks/whatsapp')
      .send({
        messageId,
        from: vendorPhone,
        reply,
        ...(inReplyTo ? { inReplyTo } : {}),
      });
  }

  async function statusOf(orderId: string): Promise<string> {
    const res = await as(customerToken)(http().get(`/me/orders/${orderId}`)).expect(200);
    return (res.body as { status: string }).status;
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

    flow = app.get(VendorOrderFlowService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    // Not the shared dev customer: `/dev/login-as` with no phone hands back one
    // account for the whole database, and this suite manufactures RTOs on it.
    // Those accumulate across every run, so §2.10.4 eventually holds its orders.
    const shopper = await createTestCustomer(app, NEARBY);
    customerToken = shopper.token;

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    vendorPhone = `+9198${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, '0')}`;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'WhatsApp Flow Traders',
        displayName: 'WhatsApp Flow Store',
        phone: vendorPhone,
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
        name: `Flow Fixture ${randomUUID()}`,
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

  describe('the store hears about the order', () => {
    let order: { id: string; orderNumber: string };
    let sent: MessageRow;

    beforeAll(async () => {
      order = await placeOrder();
      // The announcement is fired without being awaited, so the order response
      // is not held behind a messaging provider. Give it a moment to land.
      await new Promise((resolve) => setTimeout(resolve, 750));
      sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;
    });

    it('sends ORDER_NEW to the store, not to a dashboard', async () => {
      expect(sent).toBeDefined();
      expect(sent.toPhone).toBe(vendorPhone);
      expect(sent.status).toBe(MessageStatus.SENT);
    });

    it('says enough to decide without opening anything', async () => {
      // A store owner decides from the notification itself. Making them open an
      // app to see what was ordered defeats the entire §1.9.3 approach.
      expect(sent.payload['orderNumber']).toBe(order.orderNumber);
      expect(sent.payload['itemCount']).toBe(1);
      expect(sent.payload['grandTotalPaise']).toBeGreaterThan(0);
      expect(sent.payload['respondWithinMinutes']).toBeGreaterThan(0);
    });

    it('records what was sent, for when the store says it never arrived', async () => {
      // §2.12 delivery-receipt log. Without it that argument is unwinnable.
      expect(sent.providerMessageId).toBeTruthy();
    });
  });

  describe('accepting with one tap', () => {
    it('moves the order and tells the customer', async () => {
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));

      const sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;

      const res = await tap(VendorReply.ACCEPT, sent.providerMessageId).expect(201);
      expect((res.body as { handled: boolean; status: string }).handled).toBe(true);

      expect(await statusOf(order.id)).toBe(OrderStatus.ACCEPTED);
    });

    it('rejects with a reason the vendor never had to type', async () => {
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));

      const sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;

      await tap(VendorReply.REJECT, sent.providerMessageId).expect(201);
      expect(await statusOf(order.id)).toBe(OrderStatus.REASSIGNING);
    });

    it('works when the provider does not say what was replied to', async () => {
      // WhatsApp does not always echo the original message. Falling back to
      // the last thing we asked this number is what a human would assume.
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));

      await tap(VendorReply.ACCEPT, null).expect(201);
      expect(await statusOf(order.id)).toBe(OrderStatus.ACCEPTED);
    });
  });

  describe('what the webhook survives', () => {
    it('does nothing the second time the provider delivers a reply', async () => {
      // Providers retry. That is documented behaviour, not an edge case.
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;

      const messageId = randomUUID();
      await tap(VendorReply.ACCEPT, sent.providerMessageId, messageId).expect(201);

      const replay = await tap(
        VendorReply.ACCEPT,
        sent.providerMessageId,
        messageId,
      ).expect(201);

      const body = replay.body as { handled: boolean; reason: string };
      expect(body.handled).toBe(false);
      expect(body.reason).toBe('ALREADY_HANDLED');
      expect(await statusOf(order.id)).toBe(OrderStatus.ACCEPTED);
    });

    it('shrugs at a vendor who types instead of tapping', async () => {
      // "haan bhej do" is a person talking to us. That is support, not a state
      // transition — and it must not read as an error to them.
      const res = await http()
        .post('/webhooks/whatsapp')
        .send({ messageId: randomUUID(), from: vendorPhone, reply: 'haan bhej do' })
        .expect(201);

      expect((res.body as { reason: string }).reason).toBe('NOT_A_QUICK_REPLY');
    });

    it('answers 200 to something it cannot parse', async () => {
      // An error makes the provider retry, and retrying something we did not
      // understand achieves nothing except doing it again.
      const res = await http()
        .post('/webhooks/whatsapp')
        .send({ nonsense: true })
        .expect(201);
      expect((res.body as { handled: boolean }).handled).toBe(false);
    });

    it('does not fail when a tap arrives on an order that already moved', async () => {
      // The store's button was stale — support cancelled the order first. Their
      // tap was not a mistake and must not be reported as one.
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;

      await as(customerToken)(http().post(`/me/orders/${order.id}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(201);

      const res = await tap(VendorReply.ACCEPT, sent.providerMessageId).expect(201);
      expect((res.body as { reason: string }).reason).toBe('TRANSITION_REFUSED');
      expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);
    });

    it('needs no login — the caller is a provider, not a person', async () => {
      await http().post('/webhooks/whatsapp').send({ nonsense: true }).expect(201);
    });
  });

  describe('the store says nothing (§1.9.4)', () => {
    it('leaves a fresh order alone', async () => {
      // The sweep is global by design, so assert on this order rather than on
      // the counters — the shared database holds orders from other suites.
      const order = await placeOrder();
      await flow.sweepAcceptanceSla();

      const reminders = (await messagesFor(order.id)).filter(
        (m) => m.template === NotificationTemplate.ORDER_REMINDER,
      );
      expect(reminders).toHaveLength(0);
      expect(await statusOf(order.id)).toBe(OrderStatus.AWAITING_VENDOR);
    });

    it('reminds once the reminder window passes', async () => {
      const order = await placeOrder();

      // Six minutes later, with a default five-minute reminder.
      await flow.sweepAcceptanceSla(new Date(Date.now() + 6 * 60_000));

      const reminders = (await messagesFor(order.id)).filter(
        (m) => m.template === NotificationTemplate.ORDER_REMINDER,
      );
      expect(reminders).toHaveLength(1);
      expect(reminders[0]?.toPhone).toBe(vendorPhone);
    });

    it('does not nag: a second sweep sends nothing more', async () => {
      // Schedulers fire twice. The sweep has to be safe to run again.
      const order = await placeOrder();

      await flow.sweepAcceptanceSla(new Date(Date.now() + 6 * 60_000));
      await flow.sweepAcceptanceSla(new Date(Date.now() + 7 * 60_000));

      const reminders = (await messagesFor(order.id)).filter(
        (m) => m.template === NotificationTemplate.ORDER_REMINDER,
      );
      expect(reminders).toHaveLength(1);
    });

    it('gives up at the SLA, through REASSIGNING so the breach is on record', async () => {
      const order = await placeOrder();

      await flow.sweepAcceptanceSla(new Date(Date.now() + 11 * 60_000));

      expect(await statusOf(order.id)).toBe(OrderStatus.CANCELLED);

      // The audit trail distinguishes "the store ignored us" from "the customer
      // changed their mind" — which is what §6.4 vendor scoring reads.
      const res = await as(customerToken)(http().get(`/me/orders/${order.id}`)).expect(
        200,
      );
      const history = (
        res.body as { history: Array<{ toStatus: string; reason: string | null }> }
      ).history;

      expect(history.map((h) => h.toStatus)).toContain(OrderStatus.REASSIGNING);
      expect(
        history.find((h) => h.toStatus === OrderStatus.REASSIGNING)?.reason,
      ).toContain('SLA');
    });

    it('leaves an accepted order alone however long it sits', async () => {
      const order = await placeOrder();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const sent = (await messagesFor(order.id)).find(
        (m) => m.template === NotificationTemplate.ORDER_NEW,
      )!;
      await tap(VendorReply.ACCEPT, sent.providerMessageId).expect(201);

      await flow.sweepAcceptanceSla(new Date(Date.now() + 60 * 60_000));

      expect(await statusOf(order.id)).toBe(OrderStatus.ACCEPTED);
    });

    it('is reachable by ops, and closed to everyone else', async () => {
      await as(adminToken)(http().post('/internal/vendor-sla/sweep')).expect(201);
      await as(customerToken)(http().post('/internal/vendor-sla/sweep')).expect(403);
      await http().post('/internal/vendor-sla/sweep').expect(401);
    });
  });

  describe('the database constraint, not just the service check', () => {
    it('refuses the same provider message twice', async () => {
      const db = createDatabase();
      const providerMessageId = `dup-${randomUUID()}`;

      const insert = () => `
        insert into notification.inbound_message
          (channel, provider_message_id, from_phone, reply)
        values ('WHATSAPP', '${providerMessageId}', '${vendorPhone}', 'ACCEPT')
      `;

      await db.execute(insert());
      await expect(db.execute(insert())).rejects.toThrow(/inbound_message_provider_key/);
    });
  });
});
