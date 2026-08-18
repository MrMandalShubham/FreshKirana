import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GST_RATE_BP, ProductStatus, Role, Uom } from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { closeDatabase, createDatabase } from '../../../db';

loadEnv();

async function databaseIsReachable(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const db = createDatabase();
    await db.execute('select 1 from catalog.master_product limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

const dbUp = await databaseIsReachable();

if (!dbUp) {
  console.warn(
    '\n  catalog (e2e) SKIPPED - no migrated database.\n' +
      '  Run: npm run build && npm run db:migrate\n',
  );
}

describe.skipIf(!dbUp)('catalog (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;
  let categoryId: string;

  const unique = () => randomUUID().slice(0, 8);

  /**
   * A fresh 13-digit barcode per call.
   *
   * The database is shared and persistent (Cloud SQL, not a throwaway
   * container), so rows outlive the run that created them. Fixed test data
   * would collide with itself on the second run.
   */
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  function packagedProduct(overrides: Record<string, unknown> = {}) {
    const id = unique();
    return {
      slug: `aashirvaad-atta-5kg-${id}`,
      name: 'Aashirvaad Whole Wheat Atta 5kg',
      categoryId,
      netQuantity: 5,
      uom: Uom.KG,
      hsnCode: '1101',
      gstRateBp: GST_RATE_BP.FIVE,
      isPrepackaged: true,
      manufacturerPacker: 'ITC Limited, Kolkata',
      countryOfOrigin: 'India',
      consumerCareContact: 'care@itc.example',
      ...overrides,
    };
  }

  async function tokenFor(role: Role): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/dev/login-as')
      .send({ role })
      .expect(201);
    return (res.body as { token: string }).token;
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

    adminToken = await tokenFor(Role.ADMIN);
    customerToken = await tokenFor(Role.CUSTOMER);

    const cat = await request(app.getHttpServer())
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: `staples-${unique()}`, name: 'Staples', nameI18n: { hi: 'किराना' } })
      .expect(201);
    categoryId = (cat.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('access control', () => {
    it('denies an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/admin/catalog/products').expect(401);
    });

    it('denies a customer — the catalog is admin-governed (D1)', async () => {
      await request(app.getHttpServer())
        .get('/admin/catalog/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });
  });

  describe('creating products', () => {
    it('creates a complete pre-packaged product and reads it back', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ status: ProductStatus.ACTIVE, eanBarcode: uniqueEan() }))
        .expect(201);

      const created = res.body as { id: string; status: string; gstRateBp: number };
      expect(created.status).toBe(ProductStatus.ACTIVE);
      expect(created.gstRateBp).toBe(GST_RATE_BP.FIVE);

      const fetched = await request(app.getHttpServer())
        .get(`/admin/catalog/products/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((fetched.body as { hsnCode: string }).hsnCode).toBe('1101');
    });

    it('rejects an ACTIVE pre-packaged product missing Legal Metrology fields (§3.7.3)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          packagedProduct({
            status: ProductStatus.ACTIVE,
            countryOfOrigin: undefined,
            consumerCareContact: undefined,
          }),
        )
        .expect(400);

      const message = JSON.stringify(res.body);
      expect(message).toContain('countryOfOrigin');
      expect(message).toContain('consumerCareContact');
    });

    it('allows an incomplete product to exist as DRAFT', async () => {
      // Cataloguing is incremental: a half-entered product is fine, it just
      // cannot go on sale.
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          packagedProduct({ countryOfOrigin: undefined, consumerCareContact: undefined }),
        )
        .expect(201);
    });

    it('exempts loose goods, which are not pre-packaged', async () => {
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          packagedProduct({
            slug: `tomato-loose-${unique()}`,
            name: 'Tomato (loose)',
            status: ProductStatus.ACTIVE,
            isPrepackaged: false,
            isVariableWeight: true,
            pricingUom: 'PER_KG',
            netQuantity: 1,
            manufacturerPacker: undefined,
            countryOfOrigin: undefined,
            consumerCareContact: undefined,
          }),
        )
        .expect(201);
    });

    it('requires pricingUom on a variable-weight product (§1.7.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ isVariableWeight: true }))
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('pricingUom');
    });

    it('rejects a malformed HSN code', async () => {
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ hsnCode: '110' }))
        .expect(400);
    });

    it('rejects a duplicate barcode — the signal of a duplicate product (§2.4.1)', async () => {
      const ean = uniqueEan();
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ eanBarcode: ean }))
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ eanBarcode: ean }))
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('duplicate');
    });

    it('rejects a duplicate slug', async () => {
      const product = packagedProduct();
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(product)
        .expect(201);

      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(product)
        .expect(409);
    });

    it('rejects an unknown category', async () => {
      await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ categoryId: randomUUID() }))
        .expect(400);
    });
  });

  describe('activation', () => {
    it('blocks activating a DRAFT that is still missing declarations', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ consumerCareContact: undefined }))
        .expect(201);

      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/admin/catalog/products/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: ProductStatus.ACTIVE })
        .expect(400);
    });

    it('publishes a complete draft sent nothing but a status', async () => {
      // The ordinary way a product goes live: everything was filled in when it
      // was created, and publishing changes one field. Merging that patch with
      // a spread blanked every declaration it was about to check, so this
      // 400'd — see common/merge-patch.ts.
      const created = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ status: ProductStatus.DRAFT, eanBarcode: uniqueEan() }))
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/admin/catalog/products/${(created.body as { id: string }).id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: ProductStatus.ACTIVE })
        .expect(200);

      expect((res.body as { status: string }).status).toBe(ProductStatus.ACTIVE);
    });

    it('activates once the declarations are supplied', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(packagedProduct({ consumerCareContact: undefined }))
        .expect(201);

      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/admin/catalog/products/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ consumerCareContact: 'care@itc.example', status: ProductStatus.ACTIVE })
        .expect(200);
    });
  });

  describe('the database constraint, not just the service check', () => {
    it('rejects a non-compliant ACTIVE product written directly to the table', async () => {
      // Bypasses the service entirely. §3.7.3 is a legal requirement, so it is
      // enforced where a bulk import or a future admin tool cannot route
      // around it.
      //
      // Note: createDatabase() returns the process-wide pool the running app is
      // also using, so this must NOT close it afterwards.
      const db = createDatabase();

      await expect(
        db.execute(`
          insert into catalog.master_product
            (slug, name, category_id, net_quantity, uom, hsn_code, gst_rate_bp,
             is_prepackaged, status)
          values
            ('direct-write-${unique()}', 'Smuggled', '${categoryId}', 1, 'KG', '1101', 500,
             true, 'ACTIVE')
        `),
      ).rejects.toThrow(/master_product_legal_metrology/);
    });
  });

  describe('listing', () => {
    it('filters by status and paginates', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/catalog/products')
        .query({ status: ProductStatus.ACTIVE, limit: 5 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as { items: unknown[]; total: number; limit: number };
      expect(body.limit).toBe(5);
      expect(body.items.length).toBeLessThanOrEqual(5);
      expect(body.total).toBeGreaterThan(0);
    });

    it('searches by name', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/catalog/products')
        .query({ search: 'Aashirvaad' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((res.body as { total: number }).total).toBeGreaterThan(0);
    });
  });
});
