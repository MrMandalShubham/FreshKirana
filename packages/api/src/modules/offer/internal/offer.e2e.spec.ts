import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  ProductStatus,
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

loadEnv();

const dbUp = await requireDatabase('offer.vendor_offer');

describe.skipIf(!dbUp)('vendors and offers (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  /** Vendor A, and a staff account that holds a role only at A. */
  let vendorA: string;
  let staffAToken: string;
  /** Vendor B, for proving the cross-vendor denial. */
  let vendorB: string;

  let productId: string;
  let offerAId: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  async function createVendor(name: string): Promise<string> {
    const res = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `${slugify(name)}-${unique()}`,
        legalName: `${name} Enterprises`,
        displayName: name,
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '12 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    return (res.body as { id: string }).id;
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

    vendorA = await createVendor('Sharma Stores');
    vendorB = await createVendor('Gupta Kirana');

    // A staff account scoped to vendor A only. `dev/login-as` with an explicit
    // vendorId is exactly the seam that makes this testable.
    const staffA = await http()
      .post('/dev/login-as')
      .send({ role: Role.VENDOR_STAFF, vendorId: vendorA })
      .expect(201);
    staffAToken = (staffA.body as { token: string }).token;

    const category = await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `staples-${unique()}`, name: 'Staples' })
      .expect(201);

    const product = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `atta-${unique()}`,
        name: 'Aashirvaad Atta 5kg',
        categoryId: (category.body as { id: string }).id,
        netQuantity: 5,
        uom: Uom.KG,
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
        isPrepackaged: true,
        manufacturerPacker: 'ITC Limited',
        countryOfOrigin: 'India',
        consumerCareContact: 'care@itc.example',
        status: ProductStatus.ACTIVE,
      })
      .expect(201);
    productId = (product.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('vendor onboarding', () => {
    it('creates vendors as PENDING — approval is a deliberate act', async () => {
      const res = await http()
        .get(`/admin/vendors/${vendorA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((res.body as { status: string }).status).toBe('PENDING');
    });

    it('refuses to activate a vendor without an FSSAI licence (§3.7.3)', async () => {
      const res = await http()
        .post('/admin/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `no-fssai-${unique()}`,
          legalName: 'Unlicensed Traders',
          displayName: 'Unlicensed',
          phone: `+9197${Math.floor(Math.random() * 1e8)
            .toString()
            .padStart(8, '0')}`,
          addressLine: '1 Nowhere Lane',
          city: 'Bengaluru',
          pincode: '560002',
        })
        .expect(201);

      const id = (res.body as { id: string }).id;

      const activation = await http()
        .patch(`/admin/vendors/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(400);

      expect(JSON.stringify(activation.body)).toContain('FSSAI');
    });

    it('activates a vendor that has a licence', async () => {
      // The positive case, which nothing covered until P2.2 needed an ACTIVE
      // vendor: approval sends only `status`, and merging the patch with a
      // spread blanked the licence it was about to check — so no vendor could
      // ever be approved. See common/merge-patch.ts.
      const res = await http()
        .patch(`/admin/vendors/${vendorB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('ACTIVE');
    });

    it('requires a GSTIN when the vendor claims GST registration (§3.7.1)', async () => {
      await http()
        .patch(`/admin/vendors/${vendorA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gstRegistrationType: 'REGISTERED' })
        .expect(400);
    });

    it('rejects a malformed pincode', async () => {
      await http()
        .post('/admin/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `bad-pin-${unique()}`,
          legalName: 'Bad Pin',
          displayName: 'Bad Pin',
          phone: '+919700000001',
          addressLine: '1 Road',
          city: 'Bengaluru',
          pincode: '0560001',
        })
        .expect(400);
    });
  });

  describe('creating offers', () => {
    it("lets vendor A's staff list a product", async () => {
      const res = await http()
        .post(`/vendor/${vendorA}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({
          masterProductId: productId,
          mrpPaise: 28000,
          sellingPricePaise: 25500,
          inventoryMode: InventoryMode.QUANTITY,
          stockOnHand: 12,
          lowStockThreshold: 3,
        })
        .expect(201);

      const offer = res.body as { id: string; sellingPricePaise: number };
      expect(offer.sellingPricePaise).toBe(25500);
      offerAId = offer.id;
    });

    it('refuses a price above MRP — unlawful, so not merely discouraged', async () => {
      const res = await http()
        .post(`/vendor/${vendorB}/offers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ masterProductId: productId, mrpPaise: 28000, sellingPricePaise: 30000 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('MRP');
    });

    it('refuses a second offer for the same product', async () => {
      await http()
        .post(`/vendor/${vendorA}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ masterProductId: productId, mrpPaise: 28000, sellingPricePaise: 26000 })
        .expect(409);
    });

    it('refuses an offer for a product that does not exist', async () => {
      // With no cross-schema foreign key, this check *is* the referential
      // integrity — see offer/schema.ts.
      await http()
        .post(`/vendor/${vendorA}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ masterProductId: randomUUID(), mrpPaise: 100, sellingPricePaise: 100 })
        .expect(404);
    });
  });

  describe('resource-level scoping (§3.2) — the leak this prevents', () => {
    it("denies vendor A's staff access to vendor B's offers", async () => {
      await http()
        .get(`/vendor/${vendorB}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .expect(403);
    });

    it("denies vendor A's staff sight of vendor B's profile", async () => {
      await http()
        .get(`/vendor/${vendorB}/profile`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .expect(403);
    });

    it("denies vendor A's staff writing an offer for vendor B", async () => {
      await http()
        .post(`/vendor/${vendorB}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ masterProductId: productId, mrpPaise: 28000, sellingPricePaise: 20000 })
        .expect(403);
    });

    it("allows vendor A's staff their own store", async () => {
      await http()
        .get(`/vendor/${vendorA}/offers`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .expect(200);
    });

    it('allows admin across every vendor', async () => {
      await http()
        .get(`/vendor/${vendorB}/offers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('stock and price management', () => {
    it('updates price and stock', async () => {
      const res = await http()
        .patch(`/vendor/${vendorA}/offers/${offerAId}`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ sellingPricePaise: 24900, stockOnHand: 20 })
        .expect(200);

      expect((res.body as { stockOnHand: number }).stockOnHand).toBe(20);
    });

    it('filters to low stock only', async () => {
      await http()
        .patch(`/vendor/${vendorA}/offers/${offerAId}`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ stockOnHand: 2, lowStockThreshold: 3 })
        .expect(200);

      const res = await http()
        .get(`/vendor/${vendorA}/offers`)
        .query({ lowStockOnly: true, limit: 10 })
        .set('Authorization', `Bearer ${staffAToken}`)
        .expect(200);

      expect((res.body as { total: number }).total).toBeGreaterThan(0);
    });

    it("returns 404, not 403, for another vendor's offer id", async () => {
      // Deliberate: a 403 here would confirm the offer exists.
      await http()
        .get(`/vendor/${vendorB}/offers/${offerAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('the database constraints, not just the service checks', () => {
    it('rejects a price above MRP written directly to the table', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into offer.vendor_offer
            (vendor_id, master_product_id, mrp_paise, selling_price_paise)
          values
            ('${vendorB}', '${randomUUID()}', 10000, 20000)
        `),
      ).rejects.toThrow(/vendor_offer_price_not_above_mrp/);
    });

    it('rejects reserved stock exceeding stock on hand — the oversell condition', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into offer.vendor_offer
            (vendor_id, master_product_id, mrp_paise, selling_price_paise,
             stock_on_hand, stock_reserved)
          values
            ('${vendorB}', '${randomUUID()}', 10000, 9000, 2, 5)
        `),
      ).rejects.toThrow(/vendor_offer_reserved_within_stock/);
    });
  });
});
