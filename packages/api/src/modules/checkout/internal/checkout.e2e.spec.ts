import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  OrderLineStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  Role,
  ServiceAreaMode,
  StoredSlotStatus,
  SubstitutionPreference,
  Uom,
  istDateKey,
  istDayOfWeek,
  taxWithinInclusivePaise,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import { CartService } from '../../cart/contracts';
import { SlotService, type SlotView } from '../../serviceability/contracts';

loadEnv();

/**
 * A phone nobody else is using.
 *
 * `/dev/login-as` with no phone hands back one account for the whole database,
 * and P3.4 scores placement against that account's history — which the suites
 * that test failed deliveries fill with RTOs. A shared customer meant this
 * suite's cash orders were eventually held for a confirmation nobody sends.
 */
const freshPhone = () =>
  `+919${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;

const dbUp = await requireDatabase('"order"."order"');

/**
 * Its own patch of the map, for this run only — see the note in the
 * serviceability suite. Shared coordinates make one suite's stores crowd
 * another's "nearest stores" list.
 */
const STORE = {
  latitude: 8 + Math.random() * 9,
  longitude: 70 + Math.random() * 14,
};

/** ~1.5 km from the store, inside its 3 km radius. */
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };
/** ~110 km away. Outside every service area in this suite. */
const FAR_AWAY = { latitude: STORE.latitude + 1, longitude: STORE.longitude };

interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  vendorId: string;
  substitutionPreference: string;
  recipientName: string;
  addressPincode: string;
  slotStartsAt: string;
  itemsSubtotalPaise: number;
  deliveryFeePaise: number;
  smallBasketFeePaise: number;
  packagingFeePaise: number;
  grandTotalPaise: number;
  taxTotalPaise: number;
  codCollectablePaise: number;
  lines: Array<{
    name: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    hsnCode: string;
    gstRateBp: number;
    taxPaise: number;
    status: string;
  }>;
}

describe.skipIf(!dbUp)('checkout (e2e)', () => {
  let app: INestApplication;
  let carts: CartService;
  let slots: SlotService;

  let adminToken: string;
  let customerToken: string;
  let accountId: string;

  let vendorId: string;
  /** A second store, for the wrong-slot and wrong-vendor cases. */
  let otherVendorId: string;

  let addressId: string;
  let farAddressId: string;

  /** ₹255 for a 5 kg pack, MRP ₹280, taxed at 5%. */
  let offerId: string;
  /** ₹40 per kg of loose tomatoes, exempt from GST. */
  let looseOfferId: string;

  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  function http() {
    return request(app.getHttpServer());
  }

  const asCustomer = (req: request.Test) =>
    req.set('Authorization', `Bearer ${customerToken}`);

  async function createVendor(): Promise<string> {
    const res = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Checkout Test Traders',
        displayName: 'Checkout Test Store',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);

    const id = (res.body as { id: string }).id;

    await http()
      .patch(`/admin/vendors/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await http()
      .put(`/vendor/${id}/service-area`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        mode: ServiceAreaMode.RADIUS,
        centreLatitude: STORE.latitude,
        centreLongitude: STORE.longitude,
        radiusMeters: 3_000,
      })
      .expect(200);

    return id;
  }

  async function createProduct(input: {
    netQuantity: number;
    uom: Uom;
    gstRateBp: number;
    hsnCode: string;
    isVariableWeight?: boolean;
  }): Promise<string> {
    const res = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Checkout Fixture ${randomUUID()}`,
        categoryId,
        netQuantity: input.netQuantity,
        uom: input.uom,
        isVariableWeight: input.isVariableWeight ?? false,
        ...(input.isVariableWeight ? { pricingUom: 'PER_KG' } : {}),
        isPrepackaged: !input.isVariableWeight,
        hsnCode: input.hsnCode,
        gstRateBp: input.gstRateBp,
        eanBarcode: uniqueEan(),
        ...(input.isVariableWeight
          ? {}
          : {
              manufacturerPacker: 'Test Packer',
              countryOfOrigin: 'India',
              consumerCareContact: 'care@example.com',
            }),
        status: ProductStatus.ACTIVE,
      })
      .expect(201);

    return (res.body as { id: string }).id;
  }

  async function createOffer(
    vendor: string,
    masterProductId: string,
    sellingPricePaise: number,
    mrpPaise: number,
  ): Promise<string> {
    const res = await http()
      .post(`/vendor/${vendor}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId,
        mrpPaise,
        sellingPricePaise,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: 500,
      })
      .expect(201);

    return (res.body as { id: string }).id;
  }

  /** Tomorrow in IST — always past any cutoff, whatever time the suite runs. */
  const tomorrow = () => istDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

  async function defineSlot(vendor: string, startMinute: number, capacity = 10) {
    await http()
      .put(`/vendor/${vendor}/slot-definitions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dayOfWeek: istDayOfWeek(tomorrow()),
        startMinute,
        endMinute: startMinute + 120,
        pickingCapacityOrders: capacity,
        deliveryCapacityOrders: capacity,
      })
      .expect(200);
  }

  async function slotsFor(vendor: string): Promise<SlotView[]> {
    const res = await http()
      .get(`/serviceability/stores/${vendor}/slots`)
      .query({ days: 3 })
      .expect(200);
    return res.body as SlotView[];
  }

  async function bookableSlot(vendor: string): Promise<SlotView> {
    const available = await slotsFor(vendor);
    const open = available.find((s) => s.isBookable);
    if (!open) throw new Error('fixture: no bookable slot');
    return open;
  }

  async function createAddress(
    point: typeof NEARBY,
    pincode = '560001',
  ): Promise<string> {
    const res = await asCustomer(http().post('/me/addresses'))
      .send({
        label: 'HOME',
        recipientName: 'Test Recipient',
        recipientPhone: '+919812345678',
        line1: '42 Some Street',
        landmark: 'Opposite the temple',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode,
        deliveryNote: 'Ring twice',
        ...point,
      })
      .expect(201);

    return (res.body as { id: string }).id;
  }

  /** Empties the basket so each test starts from a known state. */
  async function resetCart() {
    await asCustomer(http().delete('/cart')).expect(200);
  }

  async function addToCart(offer: string, quantity?: number) {
    return asCustomer(http().post('/cart/items'))
      .send(
        quantity === undefined
          ? { vendorOfferId: offer }
          : { vendorOfferId: offer, quantity },
      )
      .expect(201);
  }

  async function place(body: Record<string, unknown>, expectStatus = 201) {
    const res = await asCustomer(http().post('/checkout/place'))
      .send(body)
      .expect(expectStatus);
    return res.body as PlacedOrder;
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

    carts = app.get(CartService);
    slots = app.get(SlotService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const customer = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER, phone: freshPhone() })
      .expect(201);
    customerToken = (customer.body as { token: string }).token;

    const me = await asCustomer(http().get('/me')).expect(200);
    accountId = (me.body as { accountId: string }).accountId;

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    vendorId = await createVendor();
    otherVendorId = await createVendor();

    await defineSlot(vendorId, 600); // 10:00–12:00 IST tomorrow
    await defineSlot(otherVendorId, 780);

    const packaged = await createProduct({
      netQuantity: 5,
      uom: Uom.KG,
      gstRateBp: GST_RATE_BP.FIVE,
      hsnCode: '1101',
    });
    offerId = await createOffer(vendorId, packaged, 25_500, 28_000);

    const loose = await createProduct({
      netQuantity: 1_000,
      uom: Uom.G,
      gstRateBp: GST_RATE_BP.EXEMPT,
      hsnCode: '0702',
      isVariableWeight: true,
    });
    looseOfferId = await createOffer(vendorId, loose, 4_000, 4_500);

    addressId = await createAddress(NEARBY);
    farAddressId = await createAddress(FAR_AWAY, '570001');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('placing a cash-on-delivery order', () => {
    let order: PlacedOrder;
    let slot: SlotView;

    beforeAll(async () => {
      await resetCart();
      await addToCart(offerId, 2); // ₹510
      slot = await bookableSlot(vendorId);

      order = await place({
        addressId,
        slotInstanceId: slot.id,
        substitutionPreference: SubstitutionPreference.ASK_ME,
      });
    });

    it('returns an order number a person can read out', async () => {
      expect(order.orderNumber).toMatch(/^FK-\d{6}-\d{5,}$/);
    });

    it('reaches the store immediately, with the money still owed', async () => {
      // COD has no payment to wait for, so it skips PENDING_PAYMENT entirely
      // and sits at payment PENDING until the rider collects (§2.6.1, §2.6.2).
      expect(order.status).toBe(OrderStatus.AWAITING_VENDOR);
      expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(order.paymentMethod).toBe(PaymentMethod.COD);
    });

    it('tells the rider exactly what to collect', async () => {
      expect(order.codCollectablePaise).toBe(order.grandTotalPaise);
    });

    it('adds up to the paisa', async () => {
      // ₹510 of items, over the ₹500 free-delivery threshold and the ₹250
      // minimum, so only the ₹5 packaging fee applies.
      expect(order.itemsSubtotalPaise).toBe(51_000);
      expect(order.deliveryFeePaise).toBe(0);
      expect(order.smallBasketFeePaise).toBe(0);
      expect(order.packagingFeePaise).toBe(500);
      expect(order.grandTotalPaise).toBe(51_500);
    });

    it('carries the line, priced and taxed', async () => {
      expect(order.lines).toHaveLength(1);

      const line = order.lines[0]!;
      expect(line.quantity).toBe(2);
      expect(line.unitPricePaise).toBe(25_500);
      expect(line.lineTotalPaise).toBe(51_000);
      expect(line.status).toBe(OrderLineStatus.PENDING);
    });

    it('extracts GST from the price rather than adding it', async () => {
      // ₹510 at 5% *contains* ₹24.29 of tax. Adding it would have made the
      // customer pay ₹535.50 for a ₹510 basket.
      const line = order.lines[0]!;
      expect(line.gstRateBp).toBe(GST_RATE_BP.FIVE);
      expect(line.hsnCode).toBe('1101');
      expect(line.taxPaise).toBe(taxWithinInclusivePaise(51_000, GST_RATE_BP.FIVE));
      expect(line.taxPaise).toBeLessThan(line.lineTotalPaise);
    });

    it('freezes the address and the slot onto the order', async () => {
      // The customer may delete this address tomorrow. The order must still
      // say where it went.
      expect(order.recipientName).toBe('Test Recipient');
      expect(order.addressPincode).toBe('560001');
      expect(new Date(order.slotStartsAt).toISOString()).toBe(slot.startsAt.toString());
    });

    it('records the substitution preference the shopper chose', async () => {
      expect(order.substitutionPreference).toBe(SubstitutionPreference.ASK_ME);
    });

    it('takes a place in the slot', async () => {
      const after = await slotsFor(vendorId);
      const booked = after.find((s) => s.id === slot.id);
      expect(booked?.booked).toBeGreaterThan(0);
    });

    it('closes the basket', async () => {
      const view = await asCustomer(http().get('/cart')).expect(200);
      expect((view.body as { lines: unknown[] }).lines).toHaveLength(0);
    });

    it('appears in order history', async () => {
      const res = await asCustomer(http().get('/me/orders')).expect(200);
      const history = res.body as PlacedOrder[];

      expect(history.some((o) => o.orderNumber === order.orderNumber)).toBe(true);
    });

    it('appears in the store queue', async () => {
      const res = await http()
        .get(`/vendor/${vendorId}/orders`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((res.body as PlacedOrder[]).some((o) => o.id === order.id)).toBe(true);
    });
  });

  describe('a basket that mixes tax slabs', () => {
    it('taxes each line at its own rate and sums them', async () => {
      // A real grocery basket is not one rate: atta is 5%, loose vegetables are
      // nil-rated. Applying a single rate to the total would overcharge tax on
      // the vegetables and misstate every invoice.
      await resetCart();
      await addToCart(offerId, 1); // ₹255 at 5%
      await addToCart(looseOfferId, 500); // ₹20 at 0%

      const slot = await bookableSlot(vendorId);
      const order = await place({ addressId, slotInstanceId: slot.id });

      const taxed = order.lines.find((l) => l.gstRateBp === GST_RATE_BP.FIVE)!;
      const exempt = order.lines.find((l) => l.gstRateBp === GST_RATE_BP.EXEMPT)!;

      expect(taxed.taxPaise).toBe(taxWithinInclusivePaise(25_500, GST_RATE_BP.FIVE));
      expect(exempt.taxPaise).toBe(0);
      expect(order.taxTotalPaise).toBe(taxed.taxPaise + exempt.taxPaise);

      // And the tax is inside what the customer pays, never added to it.
      expect(order.taxTotalPaise).toBeLessThan(order.grandTotalPaise);
    });
  });

  describe('the review screen', () => {
    beforeAll(async () => {
      await resetCart();
      await addToCart(offerId, 1);
    });

    it('reports every blocker at once, not the first one', async () => {
      // Fixing one problem only to discover the next is how a two-minute fix
      // becomes an abandoned basket.
      const res = await asCustomer(http().get('/checkout/preview')).expect(200);
      const preview = res.body as { blockers: Array<{ code: string }> };

      expect(preview.blockers.map((b) => b.code)).toContain('SLOT_REQUIRED');
    });

    it('clears once an address and a slot are chosen', async () => {
      const slot = await bookableSlot(vendorId);

      const res = await asCustomer(http().get('/checkout/preview'))
        .query({ addressId, slotInstanceId: slot.id })
        .expect(200);

      expect((res.body as { blockers: unknown[] }).blockers).toEqual([]);
    });

    it('quotes the same totals the order will carry', async () => {
      const slot = await bookableSlot(vendorId);
      const res = await asCustomer(http().get('/checkout/preview'))
        .query({ addressId, slotInstanceId: slot.id })
        .expect(200);

      const totals = (res.body as { totals: { grandTotalPaise: number } }).totals;
      // ₹255 of items: under the free-delivery threshold, over the minimum.
      expect(totals.grandTotalPaise).toBe(25_500 + 2_500 + 500);
    });
  });

  describe('what checkout refuses', () => {
    beforeAll(async () => {
      await resetCart();
      await addToCart(offerId, 1);
    });

    it('refuses an address this store cannot reach', async () => {
      // The basket is pinned to a vendor (D2), so the question is not whether
      // *anyone* delivers there — it is whether this store does.
      const slot = await bookableSlot(vendorId);
      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId: farAddressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('ADDRESS_NOT_SERVICEABLE');
    });

    it("refuses another store's slot", async () => {
      const otherSlot = await bookableSlot(otherVendorId);
      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId, slotInstanceId: otherSlot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('SLOT_WRONG_VENDOR');
    });

    it('refuses a slot past its cutoff', async () => {
      const slot = await bookableSlot(vendorId);

      await http()
        .patch(`/vendor/${vendorId}/slots/${slot.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: StoredSlotStatus.CLOSED })
        .expect(200);

      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('SLOT_CLOSED');

      await http()
        .patch(`/vendor/${vendorId}/slots/${slot.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: StoredSlotStatus.OPEN })
        .expect(200);
    });

    it("refuses someone else's address", async () => {
      const other = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_OWNER })
        .expect(201);

      const slot = await bookableSlot(vendorId);
      const res = await http()
        .post('/checkout/place')
        .set('Authorization', `Bearer ${(other.body as { token: string }).token}`)
        .send({ addressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toMatch(/ADDRESS_NOT_FOUND|CART_EMPTY/);
    });

    it('refuses an empty basket', async () => {
      await resetCart();
      const slot = await bookableSlot(vendorId);

      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('CART_EMPTY');
    });

    it('refuses a method nothing downstream can service', async () => {
      // UPI works from P3.2. Cards and wallets are fast-follow (§2.10.1): the
      // gateway supports them, but refunds, settlement and chargebacks are not
      // built for them — taking money we cannot service is worse than refusing.
      await resetCart();
      await addToCart(offerId, 1);
      const slot = await bookableSlot(vendorId);

      await asCustomer(http().post('/checkout/place'))
        .send({
          addressId,
          slotInstanceId: slot.id,
          paymentMethod: PaymentMethod.CARD,
        })
        .expect(400);
    });

    it('requires a signed-in shopper', async () => {
      await http().get('/checkout/preview').expect(401);
    });
  });

  describe('nothing half-written', () => {
    it('makes one order out of a double-tapped button', async () => {
      // Both submissions see an open cart and both reach the write. The unique
      // index on cart_id is what decides it: the loser's whole transaction
      // rolls back and it returns the winner's order.
      await resetCart();
      await addToCart(offerId, 1);
      const slot = await bookableSlot(vendorId);

      const before = await slotsFor(vendorId);
      const bookedBefore = before.find((s) => s.id === slot.id)!.booked;

      const [first, second] = await Promise.all([
        asCustomer(http().post('/checkout/place')).send({
          addressId,
          slotInstanceId: slot.id,
        }),
        asCustomer(http().post('/checkout/place')).send({
          addressId,
          slotInstanceId: slot.id,
        }),
      ]);

      // How the two interleave is genuinely timing-dependent: overlapping, both
      // succeed and return the same order; serialised, the second finds a cart
      // already converted and is refused. Asserting one interleaving makes the
      // test fail on a fast machine for no reason, so assert the invariant that
      // has to hold either way — one order, one place taken.
      const placed = [first, second].filter((r) => r.status === 201);
      expect(placed.length).toBeGreaterThanOrEqual(1);

      const ids = new Set(placed.map((r) => (r.body as PlacedOrder).id));
      expect(ids.size).toBe(1);

      const after = await slotsFor(vendorId);
      expect(after.find((s) => s.id === slot.id)!.booked).toBe(bookedBefore + 1);

      const orderNumber = (placed[0]!.body as PlacedOrder).orderNumber;
      const history = await asCustomer(http().get('/me/orders')).expect(200);
      expect(
        (history.body as PlacedOrder[]).filter((o) => o.orderNumber === orderNumber),
      ).toHaveLength(1);
    });

    it('does not place a second order from a basket already bought', async () => {
      // The retry-after-success case. The basket is CONVERTED, so this reads as
      // an empty basket rather than returning the original order — safe, but
      // not yet idempotent in the strict sense. A client-supplied idempotency
      // key lands with reservations in P3.1.
      await resetCart();
      await addToCart(offerId, 1);
      const slot = await bookableSlot(vendorId);

      const first = await place({ addressId, slotInstanceId: slot.id });

      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('CART_EMPTY');

      const history = await asCustomer(http().get('/me/orders')).expect(200);
      const sameNumber = (history.body as PlacedOrder[]).filter(
        (o) => o.orderNumber === first.orderNumber,
      );
      expect(sameNumber).toHaveLength(1);
    });

    it('leaves no order and no booking when the slot fills first', async () => {
      // The slot is booked inside the same transaction as the order, so losing
      // the race writes nothing at all — no order, and no place held against a
      // store for an order that does not exist.
      const vendor = await createVendor();
      await defineSlot(vendor, 900, 1);

      const soleProduct = await createProduct({
        netQuantity: 1,
        uom: Uom.KG,
        gstRateBp: GST_RATE_BP.FIVE,
        hsnCode: '1101',
      });
      const soleOffer = await createOffer(vendor, soleProduct, 30_000, 30_000);

      await resetCart();
      await addToCart(soleOffer, 1);

      const slot = await bookableSlot(vendor);
      expect(slot.capacity).toBe(1);

      // Somebody else takes the only place, between the preview and the write.
      await slots.book(slot.id);

      const before = await asCustomer(http().get('/me/orders')).expect(200);

      const res = await asCustomer(http().post('/checkout/place'))
        .send({ addressId, slotInstanceId: slot.id })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('SLOT_FULL');

      const after = await asCustomer(http().get('/me/orders')).expect(200);
      expect((after.body as unknown[]).length).toBe((before.body as unknown[]).length);

      // And the basket is still the shopper's, not silently consumed.
      const cart = await carts.view({ accountId });
      expect(cart.lines).toHaveLength(1);
    });
  });

  describe('the database constraints, not just the service checks', () => {
    it('refuses an order whose total is not the sum of its parts', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into "order"."order"
            (order_number, account_id, vendor_id, cart_id, status, payment_status,
             payment_method, substitution_preference, address_id, recipient_name,
             recipient_phone, address_line1, address_city, address_state,
             address_pincode, address_latitude, address_longitude,
             slot_instance_id, slot_service_date, slot_starts_at, slot_ends_at,
             items_subtotal_paise, delivery_fee_paise, small_basket_fee_paise,
             packaging_fee_paise, grand_total_paise)
          values
            ('FK-BAD-${unique()}', '${randomUUID()}', '${randomUUID()}', '${randomUUID()}',
             'AWAITING_VENDOR', 'PENDING', 'COD', 'AUTO_SUBSTITUTE', '${randomUUID()}',
             'Test', '+919812345678', '1 Road', 'Bengaluru', 'Karnataka', '560001',
             12.97, 77.59, '${randomUUID()}', '2026-09-01',
             '2026-09-01T04:30:00Z', '2026-09-01T06:30:00Z',
             10000, 2500, 0, 500, 99999)
        `),
      ).rejects.toThrow(/order_total_is_the_sum_of_its_parts/);
    });

    it('refuses two orders from the same basket', async () => {
      const db = createDatabase();
      const cartId = randomUUID();

      const insert = (number: string) => `
        insert into "order"."order"
          (order_number, account_id, vendor_id, cart_id, status, payment_status,
           payment_method, substitution_preference, address_id, recipient_name,
           recipient_phone, address_line1, address_city, address_state,
           address_pincode, address_latitude, address_longitude,
           slot_instance_id, slot_service_date, slot_starts_at, slot_ends_at,
           items_subtotal_paise, delivery_fee_paise, small_basket_fee_paise,
           packaging_fee_paise, grand_total_paise)
        values
          ('${number}', '${randomUUID()}', '${randomUUID()}', '${cartId}',
           'AWAITING_VENDOR', 'PENDING', 'COD', 'AUTO_SUBSTITUTE', '${randomUUID()}',
           'Test', '+919812345678', '1 Road', 'Bengaluru', 'Karnataka', '560001',
           12.97, 77.59, '${randomUUID()}', '2026-09-01',
           '2026-09-01T04:30:00Z', '2026-09-01T06:30:00Z',
           10000, 2500, 0, 500, 13000)
      `;

      await db.execute(insert(`FK-DUP1-${unique()}`));
      await expect(db.execute(insert(`FK-DUP2-${unique()}`))).rejects.toThrow(
        /order_cart_key/,
      );
    });

    it('refuses a line priced above MRP', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into "order".order_line
            (order_id, master_product_id, vendor_offer_id, name, slug, net_quantity,
             uom, hsn_code, gst_rate_bp, quantity, unit_price_paise, mrp_paise,
             line_total_paise, line_mrp_total_paise, status)
          values
            ('${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 'Test', 'test', 1,
             'KG', '1101', 500, 1, 30000, 28000, 30000, 28000, 'PENDING')
        `),
      ).rejects.toThrow(/order_line_price_not_above_mrp|violates foreign key/);
    });
  });
});
