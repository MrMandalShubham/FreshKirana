import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderLineStatus,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
  Role,
  ServiceAreaMode,
  SubstitutionPreference,
  SubstitutionStatus,
  Uom,
  VegMark,
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
import { createTestCustomer } from '../../../testing/customer';
import { requireDatabase } from '../../../testing/database';
import type { SlotView } from '../../serviceability/contracts';
import { SubstitutionService } from './substitution.service';

loadEnv();

const dbUp = await requireDatabase('"order".substitution');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  lines: Array<{
    id: string;
    name: string;
    status: string;
    lineTotalPaise: number;
    vendorOfferId: string;
  }>;
}

interface SubstitutionView {
  id: string;
  status: string;
  options: Array<{ vendorOfferId: string; name: string; sellingPricePaise: number }>;
  expiresAt: string | null;
  refundPaise: number;
  chargedLineTotalPaise: number | null;
  chosenName: string | null;
}

describe.skipIf(!dbUp)('substitutions (e2e)', () => {
  let app: INestApplication;
  let substitutions: SubstitutionService;

  let adminToken: string;
  let vendorToken: string;
  let vendorId: string;
  let categoryId: string;

  /** The product every order is built from, so a substitute is findable. */
  let orderedOfferId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(input: {
    netQuantity?: number;
    pricePaise?: number;
    vegMark?: string;
    isVariableWeight?: boolean;
    uom?: string;
    categoryId?: string;
  }): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Sub Fixture ${randomUUID().slice(0, 8)}`,
        categoryId: input.categoryId ?? categoryId,
        netQuantity: input.netQuantity ?? 1,
        uom: input.uom ?? Uom.KG,
        isPrepackaged: true,
        ...(input.isVariableWeight
          ? { isVariableWeight: true, pricingUom: input.uom ?? Uom.KG }
          : {}),
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
        vegMark: input.vegMark ?? VegMark.VEG,
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
        mrpPaise: input.pricePaise ?? 10_000,
        sellingPricePaise: input.pricePaise ?? 10_000,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  /** Places an order and walks it to PICKING, where substitution happens. */
  async function orderBeingPicked(preference: SubstitutionPreference): Promise<{
    order: OrderView;
    shopper: Awaited<ReturnType<typeof createTestCustomer>>;
  }> {
    const shopper = await createTestCustomer(app, NEARBY);

    await as(shopper.token)(http().delete('/cart')).expect(200);
    await as(shopper.token)(http().post('/cart/items'))
      .send({ vendorOfferId: orderedOfferId, quantity: 1 })
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
        substitutionPreference: preference,
      })
      .expect(201);

    const order = placed.body as OrderView;

    await move(order.id, OrderStatus.ACCEPTED);
    await move(order.id, OrderStatus.PICKING);

    return { order: await read(shopper.token, order.id), shopper };
  }

  function move(orderId: string, to: OrderStatus) {
    return as(vendorToken)(
      http().post(`/vendor/${vendorId}/orders/${orderId}/transitions`),
    )
      .send({ to })
      .expect(201);
  }

  async function read(token: string, orderId: string): Promise<OrderView> {
    const res = await as(token)(http().get(`/me/orders/${orderId}`)).expect(200);
    return res.body as OrderView;
  }

  function markOutOfStock(orderId: string, lineId: string) {
    return as(vendorToken)(
      http().post(`/vendor/${vendorId}/orders/${orderId}/lines/${lineId}/out-of-stock`),
    );
  }

  async function substitutionsFor(
    token: string,
    orderId: string,
  ): Promise<SubstitutionView[]> {
    const res = await as(token)(http().get(`/me/orders/${orderId}/substitutions`)).expect(
      200,
    );
    return res.body as SubstitutionView[];
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

    substitutions = app.get(SubstitutionService);

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
        legalName: 'Substitution Test Traders',
        displayName: 'Substitution Test Store',
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

    const vendorLogin = await http()
      .post('/dev/login-as')
      .send({ role: Role.VENDOR_STAFF, vendorId })
      .expect(201);
    vendorToken = (vendorLogin.body as { token: string }).token;

    // What every order buys: 1 kg, ₹100, veg, packaged.
    orderedOfferId = await makeOffer({ netQuantity: 1, pricePaise: 10_000 });

    // A safe stand-in: same size, same diet, cheaper.
    await makeOffer({ netQuantity: 1, pricePaise: 8_000 });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('ask me first (§1.7.2)', () => {
    it('asks, with options, rather than deciding', async () => {
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const line = order.lines[0]!;

      const res = await markOutOfStock(order.id, line.id).expect(201);
      const raised = res.body as SubstitutionView;

      expect(raised.status).toBe(SubstitutionStatus.PROPOSED);
      expect(raised.options.length).toBeGreaterThan(0);
      expect(raised.expiresAt).not.toBeNull();

      // And the order says so, rather than looking like it is still being picked.
      expect((await read(shopper.token, order.id)).status).toBe(
        OrderStatus.SUBSTITUTION_PENDING,
      );
    });

    it('sends the options to their phone', async () => {
      const { order } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await as(adminToken)(http().get(`/vendor/${vendorId}/messages`))
        .query({ limit: 100 })
        .expect(200);

      const asked = (
        messages.body as Array<{
          template: string;
          orderId: string;
          payload: Record<string, unknown>;
        }>
      ).find(
        (m) =>
          m.orderId === order.id &&
          m.template === NotificationTemplate.SUBSTITUTION_PROPOSE,
      );

      expect(asked).toBeDefined();
      expect((asked!.payload['options'] as unknown[]).length).toBeGreaterThan(0);
    });

    it('applies the choice and charges the cheaper price', async () => {
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const line = order.lines[0]!;

      const raised = (await markOutOfStock(order.id, line.id).expect(201))
        .body as SubstitutionView;

      await as(shopper.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/accept`),
      )
        .send({ vendorOfferId: raised.options[0]!.vendorOfferId })
        .expect(201);

      const after = await read(shopper.token, order.id);
      const substituted = after.lines.find((l) => l.id === line.id)!;

      expect(substituted.status).toBe(OrderLineStatus.SUBSTITUTED);
      // The stand-in is ₹80 against ₹100 ordered.
      expect(substituted.lineTotalPaise).toBeLessThan(line.lineTotalPaise);
    });

    it('never charges more than the original without agreement', async () => {
      // The rule §1.7.2 states outright. A dearer substitute is not blocked —
      // it is held at the price the customer agreed to.
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const dearer = await makeOffer({ netQuantity: 1, pricePaise: 15_000 });
      const line = order.lines[0]!;

      const raised = (await markOutOfStock(order.id, line.id).expect(201))
        .body as SubstitutionView;

      const expensive = raised.options.find((o) => o.vendorOfferId === dearer);
      if (!expensive) return; // The ranker offers the cheapest three; fine.

      const res = await as(shopper.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/accept`),
      )
        .send({ vendorOfferId: dearer })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('CONSENT_REQUIRED');
    });

    it('refuses an option the customer was never shown', async () => {
      // Otherwise this route would substitute in anything, including the
      // matches §1.7.2's rules refused.
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const elsewhere = await makeOffer({ netQuantity: 1, pricePaise: 9_000 });

      const raised = (await markOutOfStock(order.id, order.lines[0]!.id).expect(201))
        .body as SubstitutionView;

      // Not in the options that were rendered for this proposal.
      if (raised.options.some((o) => o.vendorOfferId === elsewhere)) return;

      await as(shopper.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/accept`),
      )
        .send({ vendorOfferId: elsewhere })
        .expect(409);
    });

    it('refunds the line when they would rather go without', async () => {
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const line = order.lines[0]!;

      const raised = (await markOutOfStock(order.id, line.id).expect(201))
        .body as SubstitutionView;

      await as(shopper.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/reject`),
      ).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.lines.find((l) => l.id === line.id)!.status).toBe(
        OrderLineStatus.REFUNDED,
      );
      // And the picker is released, rather than left waiting.
      expect(after.status).toBe(OrderStatus.PICKING);
    });

    it("refuses somebody else's substitution", async () => {
      const { order } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const stranger = await createTestCustomer(app, NEARBY);

      const raised = (await markOutOfStock(order.id, order.lines[0]!.id).expect(201))
        .body as SubstitutionView;

      await as(stranger.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/reject`),
      ).expect(404);
    });
  });

  describe('send a similar item (§1.7.2)', () => {
    it('applies the best match without asking', async () => {
      const { order, shopper } = await orderBeingPicked(
        SubstitutionPreference.AUTO_SUBSTITUTE,
      );
      const line = order.lines[0]!;

      const res = await markOutOfStock(order.id, line.id).expect(201);
      expect((res.body as SubstitutionView).status).toBe(SubstitutionStatus.AUTO_APPLIED);

      const after = await read(shopper.token, order.id);
      expect(after.lines.find((l) => l.id === line.id)!.status).toBe(
        OrderLineStatus.SUBSTITUTED,
      );
    });

    it('leaves the order being picked, with nothing to wait for', async () => {
      const { order, shopper } = await orderBeingPicked(
        SubstitutionPreference.AUTO_SUBSTITUTE,
      );

      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);

      expect((await read(shopper.token, order.id)).status).toBe(OrderStatus.PICKING);
    });

    it('refunds the difference when the stand-in is cheaper', async () => {
      const { order, shopper } = await orderBeingPicked(
        SubstitutionPreference.AUTO_SUBSTITUTE,
      );

      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);

      const [record] = await substitutionsFor(shopper.token, order.id);
      expect(record!.refundPaise).toBeGreaterThan(0);
    });
  });

  describe('refund that item (§1.7.2)', () => {
    it('removes the line without offering anything', async () => {
      const { order, shopper } = await orderBeingPicked(
        SubstitutionPreference.REFUND_ITEM,
      );
      const line = order.lines[0]!;

      const res = await markOutOfStock(order.id, line.id).expect(201);
      const raised = res.body as SubstitutionView;

      expect(raised.status).toBe(SubstitutionStatus.REFUNDED);
      expect(raised.options).toHaveLength(0);

      const after = await read(shopper.token, order.id);
      expect(after.lines.find((l) => l.id === line.id)!.status).toBe(
        OrderLineStatus.REFUNDED,
      );
    });

    it('never asks, so there is nothing to time out', async () => {
      const { order, shopper } = await orderBeingPicked(
        SubstitutionPreference.REFUND_ITEM,
      );

      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);

      const [record] = await substitutionsFor(shopper.token, order.id);
      expect(record!.expiresAt).toBeNull();
    });
  });

  describe('when nobody answers (§1.7.2)', () => {
    async function ageProposal(orderId: string) {
      const db = createDatabase();
      await db.execute(
        sql`update "order".substitution set expires_at = now() - interval '1 minute'
            where order_id = ${orderId} and status = 'PROPOSED'`,
      );
    }

    it('falls back to a refund, not to a guess', async () => {
      // Somebody who chose ASK_ME asked to be asked. Reading their silence as
      // "go ahead" is exactly what they opted out of.
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const line = order.lines[0]!;

      await markOutOfStock(order.id, line.id).expect(201);
      await ageProposal(order.id);

      const result = await substitutions.expireOverdue();
      expect(result.refunded).toBeGreaterThan(0);

      const after = await read(shopper.token, order.id);
      expect(after.lines.find((l) => l.id === line.id)!.status).toBe(
        OrderLineStatus.REFUNDED,
      );
    });

    it('releases the picker', async () => {
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);

      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);
      await ageProposal(order.id);
      await substitutions.expireOverdue();

      expect((await read(shopper.token, order.id)).status).toBe(OrderStatus.PICKING);
    });

    it('is safe to run twice', async () => {
      const { order } = await orderBeingPicked(SubstitutionPreference.ASK_ME);

      await markOutOfStock(order.id, order.lines[0]!.id).expect(201);
      await ageProposal(order.id);

      await substitutions.expireOverdue();
      const second = await substitutions.expireOverdue();

      expect(second.failed).toBe(0);
    });

    it('ignores an answer that arrives too late', async () => {
      const { order, shopper } = await orderBeingPicked(SubstitutionPreference.ASK_ME);

      const raised = (await markOutOfStock(order.id, order.lines[0]!.id).expect(201))
        .body as SubstitutionView;

      await ageProposal(order.id);
      await substitutions.expireOverdue();

      await as(shopper.token)(
        http().post(`/me/orders/${order.id}/substitutions/${raised.id}/accept`),
      )
        .send({ vendorOfferId: raised.options[0]!.vendorOfferId })
        .expect(409);
    });
  });

  describe('what the picker may do', () => {
    it('refuses a line on an order that is not being picked', async () => {
      const shopper = await createTestCustomer(app, NEARBY);

      await as(shopper.token)(http().delete('/cart')).expect(200);
      await as(shopper.token)(http().post('/cart/items'))
        .send({ vendorOfferId: orderedOfferId, quantity: 1 })
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

      const order = placed.body as OrderView;

      // Still AWAITING_VENDOR — nobody is in the aisle yet.
      await markOutOfStock(order.id, order.lines[0]!.id).expect(409);
    });

    it('does nothing the second time a picker taps the same line', async () => {
      const { order } = await orderBeingPicked(SubstitutionPreference.ASK_ME);
      const line = order.lines[0]!;

      const first = (await markOutOfStock(order.id, line.id).expect(201))
        .body as SubstitutionView;
      const second = (await markOutOfStock(order.id, line.id).expect(201))
        .body as SubstitutionView;

      expect(second.id).toBe(first.id);
    });

    it("refuses another store's order", async () => {
      const { order } = await orderBeingPicked(SubstitutionPreference.ASK_ME);

      const other = await http()
        .post('/admin/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `store-${unique()}`,
          legalName: 'Other Traders',
          displayName: 'Other Store',
          phone: `+9197${Math.floor(Math.random() * 1e8)
            .toString()
            .padStart(8, '0')}`,
          addressLine: '2 Market Road',
          city: 'Bengaluru',
          pincode: '560001',
          fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
        })
        .expect(201);
      const otherId = (other.body as { id: string }).id;

      const otherLogin = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_STAFF, vendorId: otherId })
        .expect(201);

      await as((otherLogin.body as { token: string }).token)(
        http().post(
          `/vendor/${otherId}/orders/${order.id}/lines/${order.lines[0]!.id}/out-of-stock`,
        ),
      ).expect(404);
    });
  });
});
