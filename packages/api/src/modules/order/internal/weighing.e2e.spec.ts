import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  NotificationTemplate,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
  Role,
  ServiceAreaMode,
  Uom,
  istDateKey,
  istDayOfWeek,
  kgToGrams,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createTestCustomer } from '../../../testing/customer';
import { requireDatabase } from '../../../testing/database';
import { MockRazorpayProvider, PAYMENT_PROVIDER } from '../../payment/contracts';
import type { SlotView } from '../../serviceability/contracts';

loadEnv();

const dbUp = await requireDatabase('"order".order_line');

const STORE = { latitude: 8 + Math.random() * 9, longitude: 70 + Math.random() * 14 };
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };

/** ₹100 per kg — the tomatoes every test in here buys. */
const PER_KG = 10_000;

interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  itemsSubtotalPaise: number;
  codCollectablePaise: number;
  lines: Array<{ id: string; name: string; lineTotalPaise: number }>;
  payment?: { providerOrderId: string };
}

interface WeighResult {
  actualLineTotalPaise: number;
  deltaPaise: number;
  outsideTolerance: boolean;
  absorbed: boolean;
  needsConsent: boolean;
}

describe.skipIf(!dbUp)('variable weight (e2e)', () => {
  let app: INestApplication;
  let provider: MockRazorpayProvider;

  let adminToken: string;
  let vendorToken: string;
  let branchId: string;
  let categoryId: string;
  let looseOfferId: string;
  let packagedOfferId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeOffer(variable: boolean): Promise<string> {
    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `${variable ? 'Loose' : 'Packed'} Fixture ${unique()}`,
        categoryId,
        netQuantity: 1_000,
        uom: Uom.G,
        isPrepackaged: !variable,
        ...(variable ? { isVariableWeight: true, pricingUom: 'PER_KG' } : {}),
        hsnCode: '0702',
        gstRateBp: GST_RATE_BP.EXEMPT,
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
        mrpPaise: PER_KG,
        sellingPricePaise: PER_KG,
        inventoryMode: InventoryMode.QUANTITY,
        // Stock is counted in the product's own unit, so a loose line needs
        // grams: 50 kg of tomatoes, not 50 packs. P3.1 decrements by the line's
        // quantity, and P2.1 made a measured line's quantity the amount itself.
        stockOnHand: variable ? 50_000 : 500,
      })
      .expect(201);

    return (offer.body as { id: string }).id;
  }

  /** An order being picked, so a line can be weighed. */
  async function orderBeingPicked(
    method: PaymentMethod,
    offerId = looseOfferId,
  ): Promise<{
    order: OrderView;
    shopper: Awaited<ReturnType<typeof createTestCustomer>>;
  }> {
    const shopper = await createTestCustomer(app, NEARBY);

    await as(shopper.token)(http().delete('/cart')).expect(200);
    await as(shopper.token)(http().post('/cart/items'))
      .send({ vendorOfferId: offerId, quantity: offerId === looseOfferId ? 1_000 : 1 })
      .expect(201);

    const slots = await http()
      .get(`/serviceability/stores/${branchId}/slots`)
      .query({ days: 3 })
      .expect(200);
    const slot = (slots.body as SlotView[]).find((s) => s.isBookable)!;

    const placed = await as(shopper.token)(http().post('/checkout/place'))
      .send({
        addressId: shopper.addressId,
        slotInstanceId: slot.id,
        paymentMethod: method,
      })
      .expect(201);

    const order = placed.body as OrderView;

    // Prepaid has to actually be paid before the store starts picking, which is
    // the whole reason a refund is the only way to adjust downwards later.
    if (method !== PaymentMethod.COD) {
      await capture(order.payment!.providerOrderId);
    }

    await move(order.id, OrderStatus.ACCEPTED);
    await move(order.id, OrderStatus.PICKING);

    return { order: await read(shopper.token, order.id), shopper };
  }

  /** A signed capture webhook, which is how a real payment lands. */
  async function capture(providerOrderId: string): Promise<void> {
    const body = JSON.stringify({
      id: `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
            order_id: providerOrderId,
            status: 'captured',
            amount: 10_000,
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
  }

  function move(orderId: string, to: OrderStatus) {
    return as(vendorToken)(
      http().post(`/branch/${branchId}/orders/${orderId}/transitions`),
    )
      .send({ to })
      .expect(201);
  }

  async function read(token: string, orderId: string): Promise<OrderView> {
    const res = await as(token)(http().get(`/me/orders/${orderId}`)).expect(200);
    return res.body as OrderView;
  }

  function weigh(orderId: string, lineId: string, grams: number, consented?: boolean) {
    return as(vendorToken)(
      http().post(`/branch/${branchId}/orders/${orderId}/lines/${lineId}/weight`),
    ).send(
      consented === undefined
        ? { actualGrams: grams }
        : { actualGrams: grams, consented },
    );
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

    provider = app.get<MockRazorpayProvider>(PAYMENT_PROVIDER);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const vendor = await http()
      .post('/admin/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Weight Test Traders',
        displayName: 'Weight Test Store',
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
      .send({ slug: `cat-${unique()}`, name: 'Vegetables' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const vendorLogin = await http()
      .post('/dev/login-as')
      .send({ role: Role.VENDOR_STAFF, branchId })
      .expect(201);
    vendorToken = (vendorLogin.body as { token: string }).token;

    looseOfferId = await makeOffer(true);
    packagedOfferId = await makeOffer(false);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('a lighter pack, prepaid (§1.7.1)', () => {
    it('charges for what was weighed, not what was ordered', async () => {
      // The confirmation test's first line: 1 kg ordered, 0.94 kg packed.
      const { order, shopper } = await orderBeingPicked(PaymentMethod.UPI_INTENT);
      const line = order.lines[0]!;

      const res = await weigh(order.id, line.id, kgToGrams(0.94)).expect(201);
      const outcome = res.body as WeighResult;

      expect(outcome.actualLineTotalPaise).toBe(9_400);
      expect(outcome.deltaPaise).toBe(600);

      const after = await read(shopper.token, order.id);
      expect(after.lines[0]!.lineTotalPaise).toBe(9_400);
    });

    it('adjusts the order total down with it', async () => {
      const { order, shopper } = await orderBeingPicked(PaymentMethod.UPI_INTENT);

      await weigh(order.id, order.lines[0]!.id, kgToGrams(0.94)).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.itemsSubtotalPaise).toBe(9_400);
      expect(after.grandTotalPaise).toBeLessThan(order.grandTotalPaise);
    });

    it('refunds the difference, because UPI cannot capture less (§2.10.2)', async () => {
      const { order, shopper } = await orderBeingPicked(PaymentMethod.UPI_INTENT);

      await weigh(order.id, order.lines[0]!.id, kgToGrams(0.9)).expect(201);

      const refunds = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/refunds`),
      ).expect(200);

      const owed = (refunds.body as Array<{ amountPaise: number; reason: string }>).find(
        (refund) => refund.reason === 'WEIGHT_SHORTFALL',
      );

      expect(owed?.amountPaise).toBe(1_000);
    });

    it('absorbs a difference too small to be worth refunding', async () => {
      // §1.7.1: below ₹5. A gateway fee and a bank line for less than a tomato.
      const { order, shopper } = await orderBeingPicked(PaymentMethod.UPI_INTENT);

      const res = await weigh(order.id, order.lines[0]!.id, kgToGrams(0.98)).expect(201);
      expect((res.body as WeighResult).absorbed).toBe(true);

      const refunds = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/refunds`),
      ).expect(200);

      expect(
        (refunds.body as Array<{ reason: string }>).some(
          (refund) => refund.reason === 'WEIGHT_SHORTFALL',
        ),
      ).toBe(false);
    });

    it('does not refund twice when the same weight is entered again', async () => {
      // A picker re-checking the scale is not a second refund (rule R4).
      const { order, shopper } = await orderBeingPicked(PaymentMethod.UPI_INTENT);
      const line = order.lines[0]!;

      await weigh(order.id, line.id, kgToGrams(0.9)).expect(201);
      await weigh(order.id, line.id, kgToGrams(0.9)).expect(201);

      const refunds = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/refunds`),
      ).expect(200);

      const weightRefunds = (refunds.body as Array<{ reason: string }>).filter(
        (refund) => refund.reason === 'WEIGHT_SHORTFALL',
      );

      expect(weightRefunds).toHaveLength(1);
    });
  });

  describe('a lighter pack, cash (§1.7.1)', () => {
    it('updates what the rider collects', async () => {
      const { order, shopper } = await orderBeingPicked(PaymentMethod.COD);

      await weigh(order.id, order.lines[0]!.id, kgToGrams(0.94)).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.codCollectablePaise).toBeLessThan(order.codCollectablePaise);
    });

    it('rounds the collectable to a whole rupee', async () => {
      // Settling 47 paise at a doorstep is a fiction; there is no coin for it.
      const { order, shopper } = await orderBeingPicked(PaymentMethod.COD);

      await weigh(order.id, order.lines[0]!.id, 947).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.codCollectablePaise % 100).toBe(0);
    });

    it('refunds nothing, because nothing has been taken', async () => {
      const { order, shopper } = await orderBeingPicked(PaymentMethod.COD);

      await weigh(order.id, order.lines[0]!.id, kgToGrams(0.9)).expect(201);

      const refunds = await as(shopper.token)(
        http().get(`/me/orders/${order.id}/refunds`),
      ).expect(200);

      expect(refunds.body).toHaveLength(0);
    });
  });

  describe('outside the tolerance band (§1.7.1)', () => {
    it('asks before charging for it', async () => {
      // The confirmation test's third line: 1.3 kg against a 1 kg order.
      const { order } = await orderBeingPicked(PaymentMethod.COD);

      const res = await weigh(order.id, order.lines[0]!.id, kgToGrams(1.3)).expect(201);
      const outcome = res.body as WeighResult;

      expect(outcome.outsideTolerance).toBe(true);
      expect(outcome.needsConsent).toBe(true);
    });

    it('does not record the weight while it is unanswered', async () => {
      // Recording it and asking afterwards would leave the order briefly
      // carrying a price nobody agreed to — and an invoice or a rider's
      // collectable read in that window would act on it.
      const { order, shopper } = await orderBeingPicked(PaymentMethod.COD);
      const line = order.lines[0]!;

      await weigh(order.id, line.id, kgToGrams(1.3)).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.lines[0]!.lineTotalPaise).toBe(line.lineTotalPaise);
    });

    it('tells the customer what was weighed', async () => {
      const { order } = await orderBeingPicked(PaymentMethod.COD);
      await weigh(order.id, order.lines[0]!.id, kgToGrams(1.3)).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = await as(adminToken)(http().get(`/branch/${branchId}/messages`))
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
          m.orderId === order.id && m.template === NotificationTemplate.WEIGHT_CONSENT,
      );

      expect(asked).toBeDefined();
      expect(asked!.payload['actualGrams']).toBe(1_300);
    });

    it('records it once the customer agrees', async () => {
      const { order, shopper } = await orderBeingPicked(PaymentMethod.COD);
      const line = order.lines[0]!;

      await weigh(order.id, line.id, kgToGrams(1.3), true).expect(201);

      const after = await read(shopper.token, order.id);
      expect(after.lines[0]!.lineTotalPaise).toBe(13_000);
    });

    it('flags a large shortfall too, not only an excess', async () => {
      // 0.7 kg is as much a surprise as 1.3 kg, even though it costs less.
      const { order } = await orderBeingPicked(PaymentMethod.COD);

      const res = await weigh(order.id, order.lines[0]!.id, kgToGrams(0.7)).expect(201);
      expect((res.body as WeighResult).needsConsent).toBe(true);
    });
  });

  describe('what the picker may not weigh', () => {
    it('refuses a packaged line', async () => {
      // A sealed bag is not weighed, and accepting a number for it would put a
      // fiction in the invoice §1.7.1 says must be built on the actual amount.
      const { order } = await orderBeingPicked(PaymentMethod.COD, packagedOfferId);

      const res = await weigh(order.id, order.lines[0]!.id, kgToGrams(0.9)).expect(409);
      expect(JSON.stringify(res.body)).toContain('NOT_SOLD_BY_WEIGHT');
    });

    it('refuses an order that is not being picked', async () => {
      const shopper = await createTestCustomer(app, NEARBY);

      await as(shopper.token)(http().delete('/cart')).expect(200);
      await as(shopper.token)(http().post('/cart/items'))
        .send({ vendorOfferId: looseOfferId, quantity: 1 })
        .expect(201);

      const slots = await http()
        .get(`/serviceability/stores/${branchId}/slots`)
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

      await weigh(order.id, order.lines[0]!.id, kgToGrams(0.9)).expect(409);
    });

    it('refuses a weight that is obviously a typo', async () => {
      const { order } = await orderBeingPicked(PaymentMethod.COD);

      // 60 kg of tomatoes on one line is a slipped decimal, and charging for it
      // is worse than refusing it.
      await weigh(order.id, order.lines[0]!.id, 60_000).expect(400);
    });

    it("refuses another store's order", async () => {
      const { order } = await orderBeingPicked(PaymentMethod.COD);

      const other = await http()
        .post('/admin/branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `store-${unique()}`,
          legalName: 'Other Weight Traders',
          displayName: 'Other Weight Store',
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
        .send({ role: Role.VENDOR_STAFF, branchId: otherId })
        .expect(201);

      await as((otherLogin.body as { token: string }).token)(
        http().post(
          `/branch/${otherId}/orders/${order.id}/lines/${order.lines[0]!.id}/weight`,
        ),
      )
        .send({ actualGrams: kgToGrams(0.9) })
        .expect(404);
    });
  });
});
