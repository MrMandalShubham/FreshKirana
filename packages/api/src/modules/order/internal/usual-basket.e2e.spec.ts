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

const dbUp = await requireDatabase('"order".order_line');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

interface UsualItem {
  masterProductId: string;
  vendorOfferId: string;
  name: string;
  quantity: number;
  purchaseCount: number;
  medianIntervalDays: number | null;
  confidence: number;
}

describe.skipIf(!dbUp)('usual basket (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;

  let vendorId: string;
  let addressId: string;

  /** Bought every week — the habit. */
  let attaOffer: string;
  /** Bought once — a one-off. */
  let cakeOffer: string;
  /** Bought weekly, then delisted. */
  let goneOffer: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(pricePaise: number): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Basket Fixture ${randomUUID()}`,
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
        mrpPaise: pricePaise,
        sellingPricePaise: pricePaise,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  let categoryId: string;

  /**
   * Places an order, back-dates it, and settles it as delivered.
   *
   * The heuristic is about *when* things were bought, and no test can wait
   * three weeks. Writing `placed_at` directly is the only way to exercise the
   * interval arithmetic against real orders rather than a fixture.
   *
   * The status is written for a different reason. A back-dated order left in
   * `AWAITING_VENDOR` is a three-week-old order no shop ever accepted, and
   * `sweepAcceptanceSla` — which lists *every* waiting order, not this suite's —
   * quite rightly breaches it. That moves it out of `COUNTS_AS_A_PURCHASE`, the
   * history empties, and four assertions here fail. It cost three gate runs to
   * find, and the symptom looked like flake because it depends on whether the
   * sweep suite happens to run first.
   *
   * `DELIVERED` is also simply what purchase history *is*. The fixture was
   * describing something that could not exist.
   */
  async function orderPlacedDaysAgo(offers: string[], daysAgo: number): Promise<string> {
    await as(customerToken)(http().delete('/cart')).expect(200);
    for (const offer of offers) {
      await as(customerToken)(http().post('/cart/items'))
        .send({ vendorOfferId: offer, quantity: 1 })
        .expect(201);
    }

    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const res = await as(customerToken)(http().post('/checkout/place'))
      .send({ addressId, slotInstanceId: slot.id })
      .expect(201);

    const orderId = (res.body as { id: string }).id;

    const db = createDatabase();
    await db.execute(
      `update "order"."order"
          set placed_at = now() - interval '${daysAgo} days',
              status = '${OrderStatus.DELIVERED}'
        where id = '${orderId}'`,
    );

    return orderId;
  }

  async function usualBasket(): Promise<UsualItem[]> {
    const res = await as(customerToken)(http().get('/me/usual-basket')).expect(200);
    return (res.body as { items: UsualItem[] }).items;
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

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    // A distinct account per run. The prediction is *about* one shopper's
    // history, so a customer every other suite is also ordering as would make
    // the ranking depend on what those suites happened to do.
    const login = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: `+9197${randomUUID().slice(0, 8)}` })
      .expect(201);
    customerToken = (login.body as { token: string }).token;

    const vendorForStaff = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Usual Basket Traders',
        displayName: 'Usual Basket Store',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    vendorId = (vendorForStaff.body as { id: string }).id;

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

    attaOffer = await makeOffer(30_000);
    cakeOffer = await makeOffer(45_000);
    goneOffer = await makeOffer(20_000);

    const address = await as(customerToken)(http().post('/me/addresses'))
      .send({
        label: 'HOME',
        recipientName: 'Basket Tester',
        recipientPhone: '+919812345678',
        line1: '42 Some Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        ...NEARBY,
      })
      .expect(201);
    addressId = (address.body as { id: string }).id;

    // The history the plan's confirmation test describes: three orders with
    // overlapping items, weekly, plus a one-off.
    await orderPlacedDaysAgo([attaOffer, goneOffer], 22);
    await orderPlacedDaysAgo([attaOffer, goneOffer, cakeOffer], 15);
    await orderPlacedDaysAgo([attaOffer, goneOffer], 8);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('what it predicts', () => {
    it('offers the thing bought every week', async () => {
      const items = await usualBasket();
      const atta = items.find((i) => i.vendorOfferId === attaOffer);

      expect(atta).toBeDefined();
      expect(atta!.purchaseCount).toBe(3);
      expect(atta!.medianIntervalDays).toBe(7);
    });

    it('leaves out the one-off', async () => {
      // Bought once, for a birthday. Putting it in the basket every week is how
      // a shopper learns to stop trusting the list.
      const items = await usualBasket();
      expect(items.map((i) => i.vendorOfferId)).not.toContain(cakeOffer);
    });

    it('says why each item is there', async () => {
      // "Usually every 7 days, last bought 8 days ago" is a reason a person
      // accepts. A bare list has to be checked item by item.
      const atta = (await usualBasket()).find((i) => i.vendorOfferId === attaOffer)!;

      expect(atta.medianIntervalDays).toBe(7);
      expect(atta.confidence).toBeGreaterThan(0);
      expect(atta.name).toBeTruthy();
    });

    it('carries the offer, not only the product', async () => {
      // A prediction about products cannot be added to a basket. This is the
      // offer they last bought it as, so the store and pack size stay familiar.
      const atta = (await usualBasket()).find((i) => i.vendorOfferId === attaOffer)!;
      expect(atta.vendorOfferId).toBe(attaOffer);
    });

    it('has nothing to say to a new customer', async () => {
      const fresh = await http()
        .post('/dev/login-as')
        .send({ role: Role.CUSTOMER, phone: `+9196${randomUUID().slice(0, 8)}` })
        .expect(201);

      const res = await as((fresh.body as { token: string }).token)(
        http().get('/me/usual-basket'),
      ).expect(200);

      expect((res.body as { items: unknown[] }).items).toEqual([]);
    });

    it('requires a signed-in shopper', async () => {
      await http().get('/me/usual-basket').expect(401);
    });
  });

  describe('buy again', () => {
    it('lists everything bought before, most recent first', async () => {
      const res = await as(customerToken)(http().get('/me/buy-again')).expect(200);
      const items = res.body as Array<{ vendorOfferId: string; timesOrdered: number }>;

      // Unlike the usual basket, the one-off belongs here.
      expect(items.map((i) => i.vendorOfferId)).toContain(cakeOffer);

      const atta = items.find((i) => i.vendorOfferId === attaOffer);
      expect(atta?.timesOrdered).toBe(3);
    });
  });

  describe('one tap', () => {
    it('adds the whole basket at once', async () => {
      await as(customerToken)(http().delete('/cart')).expect(200);

      const items = await usualBasket();
      const res = await as(customerToken)(http().post('/cart/items/bulk'))
        .send({
          items: items.map((i) => ({
            vendorOfferId: i.vendorOfferId,
            quantity: i.quantity,
          })),
        })
        .expect(201);

      const body = res.body as {
        added: string[];
        skipped: Array<{ reason: string }>;
        cart: { lines: unknown[] };
      };

      expect(body.added.length).toBe(items.length);
      expect(body.cart.lines).toHaveLength(items.length);
    });

    it('adds what it can and names what it cannot', async () => {
      // Partial success is a success: refusing the whole basket because one
      // item is gone turns one tap into a puzzle.
      await as(customerToken)(http().delete('/cart')).expect(200);

      await http()
        .patch(`/vendor/${vendorId}/offers/${goneOffer}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAvailable: false })
        .expect(200);

      const res = await as(customerToken)(http().post('/cart/items/bulk'))
        .send({
          items: [
            { vendorOfferId: attaOffer, quantity: 1 },
            { vendorOfferId: goneOffer, quantity: 1 },
          ],
        })
        .expect(201);

      const body = res.body as {
        added: string[];
        skipped: Array<{ vendorOfferId: string; reason: string }>;
      };

      expect(body.added).toEqual([attaOffer]);
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0]?.reason).toBe('OUT_OF_STOCK');

      await http()
        .patch(`/vendor/${vendorId}/offers/${goneOffer}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAvailable: true })
        .expect(200);
    });

    it('refuses nothing outright when every item is gone', async () => {
      await as(customerToken)(http().delete('/cart')).expect(200);

      const res = await as(customerToken)(http().post('/cart/items/bulk'))
        .send({ items: [{ vendorOfferId: randomUUID(), quantity: 1 }] })
        .expect(201);

      const body = res.body as { added: string[]; skipped: Array<{ reason: string }> };

      expect(body.added).toEqual([]);
      expect(body.skipped[0]?.reason).toBe('NO_LONGER_LISTED');
    });
  });
});
