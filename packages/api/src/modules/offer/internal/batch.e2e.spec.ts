import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BatchStatus,
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
  RecallReason,
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
import { createTestCustomer } from '../../../testing/customer';
import { requireDatabase } from '../../../testing/database';
import type { SlotView } from '../../serviceability/contracts';
import { BatchService } from './batch.service';

loadEnv();

const dbUp = await requireDatabase('offer.offer_batch');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

const DAY = 86_400_000;
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

interface BatchView {
  id: string;
  batchNo: string;
  status: string;
  remainingQuantity: number;
  expiryDate: string | null;
}

interface RecallReport {
  recallId: string;
  batchNo: string;
  batchesAffected: number;
  ordersAffected: number;
  alreadyDelivered: number;
  customersNotified: number;
  orders: Array<{ orderId: string; orderNumber: string; delivered: boolean }>;
}

describe.skipIf(!dbUp)('batches, shelf life and recall (e2e)', () => {
  let app: INestApplication;
  let batches: BatchService;

  let adminToken: string;
  let vendorToken: string;
  let vendorId: string;
  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(): Promise<{ offerId: string; productId: string }> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Perishable ${unique()}`,
        categoryId,
        netQuantity: 500,
        uom: Uom.G,
        isPrepackaged: true,
        hsnCode: '0401',
        gstRateBp: GST_RATE_BP.FIVE,
        eanBarcode: `89${Math.floor(Math.random() * 1e11)
          .toString()
          .padStart(11, '0')}`,
        manufacturerPacker: 'Test Dairy',
        countryOfOrigin: 'India',
        consumerCareContact: 'care@example.com',
        status: ProductStatus.ACTIVE,
      })
      .expect(201);

    const productId = (product.body as { id: string }).id;

    const offer = await http()
      .post(`/vendor/${vendorId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId: productId,
        mrpPaise: 6_000,
        sellingPricePaise: 6_000,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 100,
      })
      .expect(201);

    return { offerId: (offer.body as { id: string }).id, productId };
  }

  function receive(
    offerId: string,
    batchNo: string,
    expiryOffsetDays: number | null,
    mfgOffsetDays = -1,
    quantity = 10,
  ) {
    return as(vendorToken)(
      http().post(`/vendor/${vendorId}/offers/${offerId}/batches`),
    ).send({
      batchNo,
      quantity,
      mfgDate: isoDate(mfgOffsetDays),
      ...(expiryOffsetDays === null ? {} : { expiryDate: isoDate(expiryOffsetDays) }),
    });
  }

  async function listBatches(offerId: string): Promise<BatchView[]> {
    const res = await as(vendorToken)(
      http().get(`/vendor/${vendorId}/offers/${offerId}/batches`),
    ).expect(200);
    return res.body as BatchView[];
  }

  /** An order delivered to a customer, picked from a named batch. */
  async function deliveredOrder(
    offerId: string,
    batchId: string,
  ): Promise<{ orderId: string; orderNumber: string }> {
    const shopper = await createTestCustomer(app, NEARBY);

    await as(shopper.token)(http().delete('/cart')).expect(200);
    await as(shopper.token)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity: 1 })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const placed = await as(shopper.token)(http().post('/checkout/place'))
      .send({
        addressId: shopper.addressId,
        slotInstanceId: slot.id,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(201);

    const order = placed.body as {
      id: string;
      orderNumber: string;
      lines: Array<{ id: string }>;
    };

    // The picker says which crate it came out of. Without this a recall has
    // nothing to search, which is the whole argument for batches.
    await tagLineWithBatch(order.lines[0]!.id, batchId);

    for (const to of [
      OrderStatus.ACCEPTED,
      OrderStatus.PICKING,
      OrderStatus.PACKED,
      OrderStatus.READY_FOR_PICKUP,
    ]) {
      await as(vendorToken)(
        http().post(`/vendor/${vendorId}/orders/${order.id}/transitions`),
      )
        .send({ to })
        .expect(201);
    }

    return { orderId: order.id, orderNumber: order.orderNumber };
  }

  /**
   * Records the batch directly.
   *
   * The weighing route carries `offerBatchId`, but only for variable-weight
   * lines — a packaged perishable is not weighed, and P7.1's scanner is what
   * will attach a batch to those. Writing it here keeps the recall tests about
   * recall rather than about a route that does not exist yet.
   */
  async function tagLineWithBatch(orderLineId: string, batchId: string) {
    const { createDatabase } = await import('../../../db');
    const { sql } = await import('drizzle-orm');

    await createDatabase().execute(
      sql`update "order".order_line set offer_batch_id = ${batchId} where id = ${orderLineId}`,
    );
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

    batches = app.get(BatchService);

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
        legalName: 'Perishable Test Traders',
        displayName: 'Perishable Test Store',
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

    const tomorrow = istDateKey(new Date(Date.now() + DAY));
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
      .send({ slug: `cat-${unique()}`, name: 'Dairy' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const vendorLogin = await http()
      .post('/dev/login-as')
      .send({ role: Role.VENDOR_STAFF, vendorId })
      .expect(201);
    vendorToken = (vendorLogin.body as { token: string }).token;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('first expiry, first out (§1.7.3)', () => {
    it('lists the earlier-expiry batch first, whatever order they arrived in', async () => {
      // The confirmation test's first line. Monday's crate goes before
      // Thursday's, or the shop discovers the cost weeks later as waste.
      const { offerId } = await makeOffer();

      await receive(offerId, 'LATE', 20).expect(201);
      await receive(offerId, 'EARLY', 5).expect(201);

      const listed = await listBatches(offerId);
      expect(listed.map((batch) => batch.batchNo)).toEqual(['EARLY', 'LATE']);
    });

    it('hands a picker the oldest sellable lot', async () => {
      const { offerId } = await makeOffer();

      await receive(offerId, 'LATE', 20).expect(201);
      await receive(offerId, 'EARLY', 6).expect(201);

      const next = await batches.nextToPick(offerId);
      expect(next?.batchNo).toBe('EARLY');
    });

    it('skips a lot with nothing left in it', async () => {
      const { offerId } = await makeOffer();

      await receive(offerId, 'EMPTY', 5, -1, 1).expect(201);
      await receive(offerId, 'STOCKED', 15).expect(201);

      const [empty] = await listBatches(offerId);
      await batches.consume(empty!.id, 1);

      const next = await batches.nextToPick(offerId);
      expect(next?.batchNo).toBe('STOCKED');
    });

    it('puts a lot with no expiry last, not first', async () => {
      // Sorting a null expiry as zero would float every non-perishable to the
      // top of the picking list, which is the opposite of FEFO.
      const { offerId } = await makeOffer();

      await receive(offerId, 'NOEXPIRY', null).expect(201);
      await receive(offerId, 'MILK', 4).expect(201);

      const listed = await listBatches(offerId);
      expect(listed[0]!.batchNo).toBe('MILK');
    });

    it('treats the same lot arriving twice as one lot', async () => {
      // Two rows for one batch would split a recall in half: half the customers
      // found, half missed, and no way to tell from the inside.
      const { offerId } = await makeOffer();

      await receive(offerId, 'SAME', 10, -1, 10).expect(201);
      await receive(offerId, 'SAME', 10, -1, 5).expect(201);

      const listed = await listBatches(offerId);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.remainingQuantity).toBe(15);
    });
  });

  describe('minimum shelf life (§1.7.3)', () => {
    it('delists a batch too short-dated to deliver', async () => {
      // The confirmation test's second line. Made 30 days ago, 2 days left:
      // under the 30% floor.
      const { offerId } = await makeOffer();
      await receive(offerId, 'STALE', 2, -30).expect(201);

      const result = await batches.delistShortDated();
      expect(result.delisted).toBeGreaterThan(0);

      const listed = await listBatches(offerId);
      expect(listed[0]!.status).toBe(BatchStatus.DELISTED);
    });

    it('leaves a fresh batch alone', async () => {
      const { offerId } = await makeOffer();
      await receive(offerId, 'FRESH', 25, -1).expect(201);

      await batches.delistShortDated();

      const listed = await listBatches(offerId);
      expect(listed[0]!.status).toBe(BatchStatus.ACTIVE);
    });

    it('keeps the offer sellable while one good batch remains', async () => {
      // A store with a fresh crate and a stale one should keep selling.
      const { offerId } = await makeOffer();
      await receive(offerId, 'STALE', 1, -30).expect(201);
      await receive(offerId, 'FRESH', 25, -1).expect(201);

      await batches.delistShortDated();

      const offer = await as(vendorToken)(
        http().get(`/vendor/${vendorId}/offers/${offerId}`),
      ).expect(200);

      expect((offer.body as { isAvailable: boolean }).isAvailable).toBe(true);
    });

    it('closes the offer when nothing sellable is left', async () => {
      const { offerId } = await makeOffer();
      await receive(offerId, 'ONLYSTALE', 1, -30).expect(201);

      await batches.delistShortDated();

      const offer = await as(vendorToken)(
        http().get(`/vendor/${vendorId}/offers/${offerId}`),
      ).expect(200);

      expect((offer.body as { isAvailable: boolean }).isAvailable).toBe(false);
    });

    it('is safe to run twice', async () => {
      const { offerId } = await makeOffer();
      await receive(offerId, 'STALE2', 1, -30).expect(201);

      await batches.delistShortDated();
      const second = await batches.delistShortDated();

      const listed = await listBatches(offerId);
      expect(listed[0]!.status).toBe(BatchStatus.DELISTED);
      expect(second.delisted).toBe(0);
    });
  });

  describe('recall (§1.7.3)', () => {
    it('blocks further sale, lists every affected order, and can notify', async () => {
      // The confirmation test's third line, end to end.
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'BAD-LOT', 20).expect(201);

      const [batch] = await listBatches(offerId);
      const order = await deliveredOrder(offerId, batch!.id);

      const raised = await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'BAD-LOT',
          reason: RecallReason.CONTAMINATION,
          note: 'Supplier notified us of a contaminated lot.',
        })
        .expect(201);

      const report = raised.body as RecallReport;

      expect(report.batchesAffected).toBe(1);
      expect(report.orders.map((entry) => entry.orderId)).toContain(order.orderId);

      // Blocked before anybody is told: every minute a recalled lot stays
      // sellable is another customer receiving it.
      const afterRecall = await listBatches(offerId);
      expect(afterRecall[0]!.status).toBe(BatchStatus.RECALLED);

      const notified = await as(adminToken)(
        http().post(`/admin/recalls/${report.recallId}/notify`),
      ).expect(201);

      expect((notified.body as RecallReport).customersNotified).toBeGreaterThan(0);
    });

    it('tells the customer, naming the item', async () => {
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'TELL-LOT', 20).expect(201);

      const [batch] = await listBatches(offerId);
      const order = await deliveredOrder(offerId, batch!.id);

      const raised = await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'TELL-LOT',
          reason: RecallReason.QUALITY,
        })
        .expect(201);

      await as(adminToken)(
        http().post(`/admin/recalls/${(raised.body as RecallReport).recallId}/notify`),
      ).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await as(adminToken)(http().get(`/vendor/${vendorId}/messages`))
        .query({ limit: 100 })
        .expect(200);

      const told = (
        messages.body as Array<{
          template: string;
          orderId: string;
          payload: Record<string, unknown>;
        }>
      ).find(
        (m) =>
          m.orderId === order.orderId &&
          m.template === NotificationTemplate.PRODUCT_RECALL,
      );

      expect(told).toBeDefined();
      expect(told!.payload['batchNo']).toBe('TELL-LOT');
    });

    it('stops the lot being sold again', async () => {
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'STOP-LOT', 20).expect(201);

      await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'STOP-LOT',
          reason: RecallReason.REGULATORY,
        })
        .expect(201);

      expect(await batches.nextToPick(offerId)).toBeNull();
    });

    it('does not touch a different lot of the same product', async () => {
      // Withdrawing every packet of a brand when one lot is bad is ruinous for
      // the vendor and teaches customers to ignore the next recall.
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'BAD', 20).expect(201);
      await receive(offerId, 'GOOD', 25).expect(201);

      await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'BAD',
          reason: RecallReason.MANUFACTURER,
        })
        .expect(201);

      const listed = await listBatches(offerId);
      const good = listed.find((batch) => batch.batchNo === 'GOOD');

      expect(good?.status).toBe(BatchStatus.ACTIVE);
      expect((await batches.nextToPick(offerId))?.batchNo).toBe('GOOD');
    });

    it('raising the same recall twice does not notify twice', async () => {
      // Which is exactly what somebody does when the first appears not to have
      // worked.
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'TWICE-LOT', 20).expect(201);

      const first = await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'TWICE-LOT',
          reason: RecallReason.QUALITY,
        })
        .expect(201);

      const second = await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'TWICE-LOT',
          reason: RecallReason.QUALITY,
        })
        .expect(201);

      expect((second.body as RecallReport).recallId).toBe(
        (first.body as RecallReport).recallId,
      );
    });

    it('produces a report that says how far it reached', async () => {
      const { offerId, productId } = await makeOffer();
      await receive(offerId, 'REPORT-LOT', 20).expect(201);

      const [batch] = await listBatches(offerId);
      await deliveredOrder(offerId, batch!.id);

      const raised = await as(adminToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'REPORT-LOT',
          reason: RecallReason.MISLABELLED,
        })
        .expect(201);

      const recallId = (raised.body as RecallReport).recallId;
      await as(adminToken)(http().post(`/admin/recalls/${recallId}/notify`)).expect(201);

      const report = await as(adminToken)(
        http().get(`/admin/recalls/${recallId}`),
      ).expect(200);

      const body = report.body as RecallReport;
      expect(body.ordersAffected).toBeGreaterThan(0);
      expect(body.batchNo).toBe('REPORT-LOT');
      expect(body.orders[0]!.orderNumber).toMatch(/^FK-/);
    });

    it('is closed to everyone but ops', async () => {
      const shopper = await createTestCustomer(app, NEARBY);
      const { productId } = await makeOffer();

      await as(shopper.token)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'NOPE',
          reason: RecallReason.QUALITY,
        })
        .expect(403);
    });

    it('is not something a store can raise on its own', async () => {
      // A shop quietly not raising a recall is the failure mode; a shop
      // deciding one is over is the other half of it.
      const { productId } = await makeOffer();

      await as(vendorToken)(http().post('/admin/recalls'))
        .send({
          masterProductId: productId,
          batchNo: 'NOPE2',
          reason: RecallReason.QUALITY,
        })
        .expect(403);
    });
  });
});
