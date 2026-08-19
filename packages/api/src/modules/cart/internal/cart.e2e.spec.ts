import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  ProductStatus,
  QuantityMode,
  Role,
  Uom,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import type { CartView } from './cart.service';

loadEnv();

const dbUp = await requireDatabase('cart.cart');

describe.skipIf(!dbUp)('cart (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let categoryId: string;

  let vendorA: string;
  let vendorB: string;

  /** 5 kg pack at Rs255, MRP Rs280. */
  let packagedOfferA: string;
  /** Loose tomatoes, Rs40 per 1000 g. */
  let looseOfferA: string;
  /** Same product listed by vendor B, for the D2 conflict. */
  let packagedOfferB: string;

  const unique = () => randomUUID().slice(0, 8);
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  function http() {
    return request(app.getHttpServer());
  }

  /** A fresh anonymous basket per test, so tests cannot share one. */
  const newToken = () => `cart-${randomUUID()}`;

  async function createVendor(): Promise<string> {
    const res = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `shop-${unique()}`,
        legalName: 'Cart Test Traders',
        displayName: 'Cart Test Shop',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function createProduct(input: {
    netQuantity: number;
    uom: Uom;
    isVariableWeight?: boolean;
  }): Promise<string> {
    const res = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `p-${unique()}`,
        name: `Cart Fixture ${randomUUID()}`,
        categoryId,
        netQuantity: input.netQuantity,
        uom: input.uom,
        isVariableWeight: input.isVariableWeight ?? false,
        ...(input.isVariableWeight ? { pricingUom: 'PER_KG' } : {}),
        isPrepackaged: !input.isVariableWeight,
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
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
    vendorId: string,
    masterProductId: string,
    sellingPricePaise: number,
    mrpPaise: number,
    opts: { stock?: number } = {},
  ): Promise<string> {
    const res = await http()
      .post(`/vendor/${vendorId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId,
        mrpPaise,
        sellingPricePaise,
        inventoryMode: InventoryMode.QUANTITY,
        stockOnHand: opts.stock ?? 50,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function addItem(
    token: string,
    vendorOfferId: string,
    quantity?: number,
    expectStatus = 201,
  ) {
    const res = await http()
      .post('/cart/items')
      .set('x-cart-token', token)
      .send(quantity === undefined ? { vendorOfferId } : { vendorOfferId, quantity })
      .expect(expectStatus);
    return res.body as CartView;
  }

  async function viewCart(token: string) {
    const res = await http().get('/cart').set('x-cart-token', token).expect(200);
    return res.body as CartView;
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

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `cat-${unique()}`, name: 'Staples' })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    vendorA = await createVendor();
    vendorB = await createVendor();

    const packaged = await createProduct({ netQuantity: 5, uom: Uom.KG });
    packagedOfferA = await createOffer(vendorA, packaged, 25500, 28000);
    packagedOfferB = await createOffer(vendorB, packaged, 24000, 28000);

    const loose = await createProduct({
      netQuantity: 1000,
      uom: Uom.G,
      isVariableWeight: true,
    });
    looseOfferA = await createOffer(vendorA, loose, 4000, 4500);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('a basket before signup', () => {
    it('starts empty', async () => {
      const view = await viewCart(newToken());
      expect(view.lines).toHaveLength(0);
      expect(view.totals.grandTotalPaise).toBe(0);
    });

    it('holds items for an anonymous shopper', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA, 2);

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(2);
      expect(view.vendorId).toBe(vendorA);
    });

    it('persists across requests', async () => {
      // The basket lives in the database, not the session: closing the browser
      // must not lose it.
      const token = newToken();
      await addItem(token, packagedOfferA, 3);

      const reloaded = await viewCart(token);
      expect(reloaded.lines[0]?.quantity).toBe(3);
    });

    it('refuses a basket with no owner at all', async () => {
      await http()
        .post('/cart/items')
        .send({ vendorOfferId: packagedOfferA })
        .expect(400);
    });
  });

  describe('one basket, one shop (decision D2)', () => {
    it('pins the basket to the first vendor', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA);
      expect(view.vendorId).toBe(vendorA);
    });

    it('refuses a second shop, and says what the conflict is', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA);

      const res = await http()
        .post('/cart/items')
        .set('x-cart-token', token)
        .send({ vendorOfferId: packagedOfferB })
        .expect(409);

      const body = res.body as {
        code?: string;
        currentVendorId?: string;
        requestedVendorId?: string;
      };

      // The response has to carry both ids: the UI cannot offer "switch shop"
      // without knowing what it is switching between.
      expect(body.code).toBe('CART_VENDOR_CONFLICT');
      expect(body.currentVendorId).toBe(vendorA);
      expect(body.requestedVendorId).toBe(vendorB);
    });

    it('frees the basket for any shop once emptied', async () => {
      const token = newToken();
      const added = await addItem(token, packagedOfferA);

      const emptied = await http()
        .delete(`/cart/items/${added.lines[0]!.id}`)
        .set('x-cart-token', token)
        .expect(200);

      expect((emptied.body as CartView).vendorId).toBeNull();

      // The other shop is now allowed.
      const switched = await addItem(token, packagedOfferB);
      expect(switched.vendorId).toBe(vendorB);
    });
  });

  describe('quantities respect the unit', () => {
    it('counts packaged goods in packs', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA, 2);

      const line = view.lines[0]!;
      expect(line.quantityMode).toBe(QuantityMode.PACKS);
      expect(line.quantityStep).toBe(1);
      // Two 5 kg packs at Rs255.
      expect(line.lineTotalPaise).toBe(51000);
    });

    it('counts loose goods by measure and prices them pro rata', async () => {
      const token = newToken();
      const view = await addItem(token, looseOfferA, 1500);

      const line = view.lines[0]!;
      expect(line.quantityMode).toBe(QuantityMode.MEASURE);
      expect(line.quantityStep).toBe(250);
      // Rs40 per 1000 g, 1500 g requested.
      expect(line.lineTotalPaise).toBe(6000);
    });

    it('rounds a loose quantity to something a picker can weigh out', async () => {
      // 300 g against a 250 g step becomes 250 g, rather than a picker guessing.
      const token = newToken();
      const view = await addItem(token, looseOfferA, 300);
      expect(view.lines[0]?.quantity).toBe(250);
    });

    it('never rounds a request down to nothing', async () => {
      const token = newToken();
      const view = await addItem(token, looseOfferA, 10);
      expect(view.lines[0]?.quantity).toBe(250);
    });

    it('adds to the existing line instead of showing the product twice', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA, 1);
      const view = await addItem(token, packagedOfferA, 2);

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(3);
    });

    it('rejects a non-positive quantity', async () => {
      const token = newToken();
      await http()
        .post('/cart/items')
        .set('x-cart-token', token)
        .send({ vendorOfferId: packagedOfferA, quantity: 0 })
        .expect(400);
    });
  });

  describe('totals', () => {
    it('adds up to the paisa', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA, 1);
      const view = await addItem(token, looseOfferA, 500);

      const lineSum = view.lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
      expect(view.totals.subtotalPaise).toBe(lineSum);
      expect(view.totals.grandTotalPaise).toBe(
        view.totals.subtotalPaise +
          view.totals.deliveryFeePaise +
          view.totals.smallBasketFeePaise +
          view.totals.packagingFeePaise,
      );
    });

    it('shows savings against MRP', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA, 2);
      // (Rs280 - Rs255) x 2
      expect(view.totals.savingsPaise).toBe(5000);
    });

    it('charges a small-basket fee below the minimum order value', async () => {
      const token = newToken();
      const view = await addItem(token, looseOfferA, 250); // Rs10

      expect(view.totals.meetsMinimumOrder).toBe(false);
      expect(view.totals.smallBasketFeePaise).toBeGreaterThan(0);
      expect(view.totals.amountToMinimumOrderPaise).toBeGreaterThan(0);
    });

    it('reports the distance to free delivery for the progress bar', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA, 1); // Rs255

      expect(view.totals.deliveryFeePaise).toBeGreaterThan(0);
      expect(view.totals.amountToFreeDeliveryPaise).toBe(50000 - 25500);
    });

    it('waives delivery on a large enough basket', async () => {
      const token = newToken();
      const view = await addItem(token, packagedOfferA, 2); // Rs510

      expect(view.totals.deliveryFeePaise).toBe(0);
      expect(view.totals.amountToFreeDeliveryPaise).toBe(0);
    });
  });

  describe('prices move', () => {
    it('charges the live price and flags that it changed', async () => {
      // A snapshot would either short the vendor or overcharge the shopper.
      const product = await createProduct({ netQuantity: 1, uom: Uom.KG });
      const offer = await createOffer(vendorA, product, 10000, 12000);

      const token = newToken();
      await addItem(token, offer, 1);

      await http()
        .patch(`/vendor/${vendorA}/offers/${offer}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sellingPricePaise: 11000 })
        .expect(200);

      const view = await viewCart(token);
      const line = view.lines[0]!;

      expect(line.unitPricePaise).toBe(11000);
      expect(line.addedAtPricePaise).toBe(10000);
      expect(line.priceChanged).toBe(true);
      expect(view.totals.subtotalPaise).toBe(11000);
    });

    it('keeps an item that sold out visible but out of the total', async () => {
      // Removing it silently would let a shopper reach checkout believing they
      // had ordered something they had not.
      const product = await createProduct({ netQuantity: 1, uom: Uom.KG });
      const offer = await createOffer(vendorA, product, 9000, 9000, { stock: 5 });

      const token = newToken();
      await addItem(token, offer, 1);

      await http()
        .patch(`/vendor/${vendorA}/offers/${offer}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAvailable: false })
        .expect(200);

      const view = await viewCart(token);

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.isAvailable).toBe(false);
      expect(view.unavailableLineIds).toContain(view.lines[0]!.id);
      expect(view.totals.subtotalPaise).toBe(0);
    });

    it('refuses to add something already out of stock', async () => {
      const product = await createProduct({ netQuantity: 1, uom: Uom.KG });
      const offer = await createOffer(vendorA, product, 9000, 9000, { stock: 0 });

      await http()
        .post('/cart/items')
        .set('x-cart-token', newToken())
        .send({ vendorOfferId: offer })
        .expect(409);
    });
  });

  describe('editing', () => {
    it('changes a quantity', async () => {
      const token = newToken();
      const added = await addItem(token, packagedOfferA, 1);

      const res = await http()
        .patch(`/cart/items/${added.lines[0]!.id}`)
        .set('x-cart-token', token)
        .send({ quantity: 4 })
        .expect(200);

      expect((res.body as CartView).lines[0]?.quantity).toBe(4);
    });

    it('clears the basket', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA, 2);

      const res = await http().delete('/cart').set('x-cart-token', token).expect(200);
      const view = res.body as CartView;

      expect(view.lines).toHaveLength(0);
      expect(view.vendorId).toBeNull();
    });

    it("returns 404, not 403, for another basket's line", async () => {
      const mine = newToken();
      const theirs = newToken();
      const added = await addItem(theirs, packagedOfferA);
      await addItem(mine, packagedOfferA);

      // A 403 here would confirm that line exists.
      await http()
        .patch(`/cart/items/${added.lines[0]!.id}`)
        .set('x-cart-token', mine)
        .send({ quantity: 2 })
        .expect(404);
    });

    it('records the substitution preference (§1.7.2)', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA);

      const res = await http()
        .patch('/cart/substitution-preference')
        .set('x-cart-token', token)
        .send({ preference: 'ASK_ME' })
        .expect(200);

      expect((res.body as CartView).substitutionPreference).toBe('ASK_ME');
    });
  });

  describe('signing in', () => {
    it('claims the anonymous basket for the account', async () => {
      const token = newToken();
      await addItem(token, packagedOfferA, 2);

      const login = await http()
        .post('/dev/login-as')
        .send({ role: Role.CUSTOMER })
        .expect(201);
      const customerToken = (login.body as { token: string }).token;

      const claimed = await http()
        .post('/cart/claim')
        .set('x-cart-token', token)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      expect((claimed.body as CartView).lines[0]?.quantity).toBe(2);

      // And the account now sees it without the token.
      const res = await http()
        .get('/cart')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect((res.body as CartView).lines).toHaveLength(1);
    });

    it('prefers the account over a stale token still sent by the browser', async () => {
      const login = await http()
        .post('/dev/login-as')
        .send({ role: Role.CUSTOMER })
        .expect(201);
      const customerToken = (login.body as { token: string }).token;

      // The dev login returns a seeded account, so start from a known basket
      // rather than whatever an earlier test or run left behind.
      await http()
        .delete('/cart')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const staleToken = newToken();
      await addItem(staleToken, looseOfferA, 250);

      // Signed in, the stale token must be ignored - otherwise the shopper
      // adds into a basket their order history will never see.
      const res = await http()
        .get('/cart')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('x-cart-token', staleToken)
        .expect(200);

      const view = res.body as CartView;
      expect(view.lines.every((l) => l.vendorOfferId !== looseOfferA)).toBe(true);
    });
  });

  describe('the database constraints, not just the service checks', () => {
    it('refuses a basket with no owner', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`insert into cart.cart (account_id, anon_id) values (null, null)`),
      ).rejects.toThrow(/cart_has_an_owner/);
    });

    it('refuses a non-positive quantity', async () => {
      const db = createDatabase();
      const owner = randomUUID();
      await db.execute(
        `insert into cart.cart (id, anon_id) values ('${owner}', 'direct-${owner}')`,
      );

      await expect(
        db.execute(`
          insert into cart.cart_line (cart_id, vendor_offer_id, master_product_id, quantity, added_at_price_paise)
          values ('${owner}', '${randomUUID()}', '${randomUUID()}', 0, 100)
        `),
      ).rejects.toThrow(/cart_line_quantity_positive/);
    });
  });
});
