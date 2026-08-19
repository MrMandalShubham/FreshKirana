import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  OrderStatus,
  ProductStatus,
  ReservationOutcome,
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
import { closeDatabase, createDatabase } from '../../../db';
import type { SlotView } from '../../serviceability/contracts';
import { InventoryService } from './inventory.service';

loadEnv();

async function databaseIsReachable(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const db = createDatabase();
    await db.execute('select 1 from inventory.reservation limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

const dbUp = await databaseIsReachable();

if (!dbUp) console.warn('\n  inventory (e2e) SKIPPED - no migrated database.\n');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

describe.skipIf(!dbUp)('inventory reservations (e2e)', () => {
  let app: INestApplication;
  let inventory: InventoryService;

  let adminToken: string;
  let customerToken: string;
  let secondCustomerToken: string;

  let vendorId: string;
  let categoryId: string;
  let addressId: string;
  let secondAddressId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  /** An offer with a known count and mode. */
  async function makeOffer(
    stockOnHand: number,
    inventoryMode: InventoryMode = InventoryMode.QUANTITY,
  ): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Stock Fixture ${randomUUID()}`,
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
        mrpPaise: 30_000,
        sellingPricePaise: 30_000,
        inventoryMode,
        stockOnHand,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  async function stockOf(offerId: string) {
    const res = await http()
      .get(`/vendor/${vendorId}/offers/${offerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    return res.body as { stockOnHand: number; stockReserved: number };
  }

  async function bookableSlot(): Promise<SlotView> {
    const slots = await http()
      .get(`/serviceability/stores/${vendorId}/slots`)
      .query({ days: 3 })
      .expect(200);

    const open = (slots.body as SlotView[]).find((s) => s.isBookable);
    if (!open) throw new Error('fixture: no bookable slot');
    return open;
  }

  /** A whole checkout, as a browser would do it. */
  async function checkout(token: string, address: string, offerId: string, quantity = 1) {
    await as(token)(http().delete('/cart')).expect(200);
    await as(token)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity })
      .expect(201);

    const slot = await bookableSlot();

    return as(token)(http().post('/checkout/place')).send({
      addressId: address,
      slotInstanceId: slot.id,
    });
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

    inventory = app.get(InventoryService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    // Two distinct shoppers: the oversell race needs two people, and one
    // account cannot hold two carts.
    const first = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: `+9195${randomUUID().slice(0, 8)}` })
      .expect(201);
    customerToken = (first.body as { token: string }).token;

    const second = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: `+9194${randomUUID().slice(0, 8)}` })
      .expect(201);
    secondCustomerToken = (second.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Stock Test Traders',
        displayName: 'Stock Test Store',
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

    const address = {
      label: 'HOME',
      recipientName: 'Stock Tester',
      recipientPhone: '+919812345678',
      line1: '42 Some Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      ...NEARBY,
    };

    const created = await as(customerToken)(http().post('/me/addresses'))
      .send(address)
      .expect(201);
    addressId = (created.body as { id: string }).id;

    const secondCreated = await as(secondCustomerToken)(http().post('/me/addresses'))
      .send(address)
      .expect(201);
    secondAddressId = (secondCreated.body as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('the last packet', () => {
    it('goes to exactly one of two simultaneous checkouts', async () => {
      // The condition this whole part exists for. One unit, two browsers.
      const offerId = await makeOffer(1);

      await as(customerToken)(http().delete('/cart')).expect(200);
      await as(secondCustomerToken)(http().delete('/cart')).expect(200);

      await as(customerToken)(http().post('/cart/items'))
        .send({ vendorOfferId: offerId, quantity: 1 })
        .expect(201);
      await as(secondCustomerToken)(http().post('/cart/items'))
        .send({ vendorOfferId: offerId, quantity: 1 })
        .expect(201);

      const slot = await bookableSlot();

      const [first, second] = await Promise.all([
        as(customerToken)(http().post('/checkout/place')).send({
          addressId,
          slotInstanceId: slot.id,
        }),
        as(secondCustomerToken)(http().post('/checkout/place')).send({
          addressId: secondAddressId,
          slotInstanceId: slot.id,
        }),
      ]);

      const placed = [first, second].filter((r) => r.status === 201);
      const refused = [first, second].filter((r) => r.status !== 201);

      expect(placed).toHaveLength(1);
      expect(refused).toHaveLength(1);

      // And the refusal names the item, because "something went wrong" on a
      // checkout screen is indistinguishable from a bug.
      expect(JSON.stringify(refused[0]!.body)).toContain('INSUFFICIENT_STOCK');

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(1);
    });

    it('never lets reserved exceed what is on the shelf', async () => {
      const offerId = await makeOffer(3);

      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          inventory.reserve({
            vendorOfferId: offerId,
            quantity: 1,
            idempotencyKey: `race-${randomUUID()}-${index}`,
            ttlMinutes: 10,
          }),
        ),
      );

      const reserved = attempts.filter(
        (a) =>
          a.status === 'fulfilled' && a.value.outcome === ReservationOutcome.RESERVED,
      );

      expect(reserved).toHaveLength(3);

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(3);
      expect(stock.stockReserved).toBeLessThanOrEqual(stock.stockOnHand);
    });

    it('says so plainly when there is none left', async () => {
      const offerId = await makeOffer(1);

      await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 1,
        idempotencyKey: `first-${randomUUID()}`,
        ttlMinutes: 10,
      });

      const result = await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 1,
        idempotencyKey: `second-${randomUUID()}`,
        ttlMinutes: 10,
      });

      expect(result.outcome).toBe(ReservationOutcome.INSUFFICIENT_STOCK);
      expect(result.reservationId).toBeNull();
    });
  });

  describe('idempotency (rule R4)', () => {
    it('decrements once however many times the call is replayed', async () => {
      // A network timeout is indistinguishable from a failure to the client, so
      // clients retry. Without the key, the retry takes a second unit.
      const offerId = await makeOffer(5);
      const key = `replay-${randomUUID()}`;

      const first = await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 2,
        idempotencyKey: key,
        ttlMinutes: 10,
      });

      const replay = await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 2,
        idempotencyKey: key,
        ttlMinutes: 10,
      });

      expect(first.outcome).toBe(ReservationOutcome.RESERVED);
      expect(replay.outcome).toBe(ReservationOutcome.ALREADY_RESERVED);
      expect(replay.reservationId).toBe(first.reservationId);

      expect((await stockOf(offerId)).stockReserved).toBe(2);
    });

    it('is enforced by the database, not only by the check', async () => {
      const db = createDatabase();
      const key = `dup-${randomUUID()}`;

      const insert = () => `
        insert into inventory.reservation (vendor_offer_id, quantity, idempotency_key)
        values ('${randomUUID()}', 1, '${key}')
      `;

      await db.execute(insert());
      await expect(db.execute(insert())).rejects.toThrow(/reservation_idempotency_key/);
    });
  });

  describe('the tiered modes (§1.9.2)', () => {
    it('does not reserve for a shop that keeps no counts', async () => {
      // Not a failure. §1.9.2 lets a kirana trade in toggle mode and accept a
      // higher substitution rate — refusing would exclude most shops on day one.
      const offerId = await makeOffer(0, InventoryMode.TOGGLE);

      const result = await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 4,
        idempotencyKey: `toggle-${randomUUID()}`,
        ttlMinutes: 10,
      });

      expect(result.outcome).toBe(ReservationOutcome.MODE_DOES_NOT_RESERVE);
      expect((await stockOf(offerId)).stockReserved).toBe(0);
    });

    it('lets a toggle-mode order through regardless of the count', async () => {
      const offerId = await makeOffer(0, InventoryMode.TOGGLE);
      const res = await checkout(customerToken, addressId, offerId, 1);

      expect(res.status).toBe(201);
    });
  });

  describe('abandoned checkouts (§2.5)', () => {
    it('gives the stock back once the hold expires', async () => {
      const offerId = await makeOffer(2);

      const held = await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 2,
        idempotencyKey: `expiring-${randomUUID()}`,
        // Already expired: somebody opened a payment app twenty minutes ago
        // and never came back.
        ttlMinutes: -1,
      });

      expect(held.outcome).toBe(ReservationOutcome.RESERVED);
      expect((await stockOf(offerId)).stockReserved).toBe(2);

      const swept = await inventory.sweepExpired();
      expect(swept.released).toBeGreaterThan(0);

      expect((await stockOf(offerId)).stockReserved).toBe(0);
    });

    it('never touches a confirmed hold, however old', async () => {
      // The money is settled. A sweeper releasing that stock would leave an
      // order nobody can pack.
      const offerId = await makeOffer(2);
      const res = await checkout(customerToken, addressId, offerId, 1);
      expect(res.status).toBe(201);

      await inventory.sweepExpired(new Date(Date.now() + 24 * 60 * 60 * 1000));

      expect((await stockOf(offerId)).stockReserved).toBe(1);
    });

    it('is safe to run twice', async () => {
      // Schedulers fire twice. A second pass must not give the same stock back
      // again, which would inflate the shelf count.
      const offerId = await makeOffer(2);

      await inventory.reserve({
        vendorOfferId: offerId,
        quantity: 2,
        idempotencyKey: `twice-${randomUUID()}`,
        ttlMinutes: -1,
      });

      await inventory.sweepExpired();
      await inventory.sweepExpired();

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(0);
      expect(stock.stockOnHand).toBe(2);
    });
  });

  describe('the order life cycle moves the stock with it', () => {
    it('holds stock when the order is placed', async () => {
      const offerId = await makeOffer(5);
      const res = await checkout(customerToken, addressId, offerId, 2);
      expect(res.status).toBe(201);

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(2);
      expect(stock.stockOnHand).toBe(5);

      // Confirmed immediately: COD has no payment to wait for.
      const held = await inventory.forOrder((res.body as { id: string }).id);
      expect(held).toHaveLength(1);
      expect(held[0]?.status).toBe(ReservationStatus.CONFIRMED);
      expect(held[0]?.expiresAt).toBeNull();
    });

    it('gives it back when the order is cancelled', async () => {
      const offerId = await makeOffer(5);
      const res = await checkout(customerToken, addressId, offerId, 2);
      const orderId = (res.body as { id: string }).id;

      await as(customerToken)(http().post(`/me/orders/${orderId}/cancel`))
        .send({ reason: 'Changed my mind' })
        .expect(201);

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(0);
      expect(stock.stockOnHand).toBe(5);
    });

    it('takes it off the shelf when the order is packed', async () => {
      // Packed, so the goods physically left. Both counters move together, or
      // the shelf count drifts from reality on every order.
      const offerId = await makeOffer(5);
      const res = await checkout(customerToken, addressId, offerId, 2);
      const orderId = (res.body as { id: string }).id;

      for (const to of [OrderStatus.ACCEPTED, OrderStatus.PICKING, OrderStatus.PACKED]) {
        await http()
          .post(`/vendor/${vendorId}/orders/${orderId}/transitions`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ to })
          .expect(201);
      }

      const stock = await stockOf(offerId);
      expect(stock.stockOnHand).toBe(3);
      expect(stock.stockReserved).toBe(0);
    });

    it('does not give the same stock back twice', async () => {
      // Support cancelling while a customer cancels. The second release must
      // be a no-op, or the shop believes it has stock it already sold.
      const offerId = await makeOffer(4);
      const res = await checkout(customerToken, addressId, offerId, 2);
      const orderId = (res.body as { id: string }).id;

      await inventory.releaseForOrder(orderId, 'first');
      await inventory.releaseForOrder(orderId, 'second');

      const stock = await stockOf(offerId);
      expect(stock.stockReserved).toBe(0);
      expect(stock.stockOnHand).toBe(4);
    });
  });

  describe('the ledger behind the counter', () => {
    it('agrees with the number on the offer', async () => {
      // `stock_reserved` is a number that can drift; the reservation rows are
      // what it should have been. A mismatch is worth catching here rather
      // than when a picker finds an empty shelf.
      const offerId = await makeOffer(6);
      await checkout(customerToken, addressId, offerId, 3);

      const stock = await stockOf(offerId);
      expect(await inventory.heldFor(offerId)).toBe(stock.stockReserved);
    });
  });
});
