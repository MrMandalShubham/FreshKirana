import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GST_RATE_BP, Role, Uom } from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { closeDatabase, createDatabase } from '../../../db';
import type { ImportReport } from './catalog-import.service';

loadEnv();

async function databaseIsReachable(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const db = createDatabase();
    await db.execute('select 1 from catalog.product_request limit 1');
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
    '\n  catalog seeding (e2e) SKIPPED - no migrated database.\n' +
      '  Run: npm run build && npm run db:migrate\n',
  );
}

describe.skipIf(!dbUp)('catalog seeding (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let vendorA: string;
  let vendorB: string;
  let staffAToken: string;
  let categorySlug: string;

  const unique = () => randomUUID().slice(0, 8);
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  /**
   * Product **names** must be unique per run, not just slugs and barcodes.
   *
   * Name similarity is itself a dedupe signal here, and the database is shared
   * and persistent, so last run's products are still present. Merely
   * *distinct* names are not enough: "Imported Atta 5kg" plus a short suffix
   * still scores ~0.53 against last run's copy, above the 0.45 threshold,
   * because the shared base text dominates the trigrams.
   *
   * The token therefore has to dominate instead — a full UUID drops
   * cross-run similarity to roughly 0.2. Where a test needs two names to
   * *look* alike, it shares one token deliberately.
   */
  const uniqueName = (base: string) => `${base} ${randomUUID()}`;

  function http() {
    return request(app.getHttpServer());
  }

  const CSV_HEADER =
    'slug,name,category_slug,net_quantity,uom,hsn_code,gst_rate_bp,ean_barcode,is_prepackaged,manufacturer_packer,country_of_origin,consumer_care_contact,activate';

  async function createVendor(): Promise<string> {
    const res = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `shop-${unique()}`,
        legalName: 'Test Traders',
        displayName: 'Test Shop',
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

    categorySlug = `staples-${unique()}`;
    await http()
      .post('/admin/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slug: categorySlug, name: 'Staples' })
      .expect(201);

    vendorA = await createVendor();
    vendorB = await createVendor();

    const staffA = await http()
      .post('/dev/login-as')
      .send({ role: Role.VENDOR_STAFF, vendorId: vendorA })
      .expect(201);
    staffAToken = (staffA.body as { token: string }).token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function importCsv(csv: string, expectStatus = 201): Promise<ImportReport> {
    const res = await http()
      .post('/admin/catalog/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ csv })
      .expect(expectStatus);
    return res.body as ImportReport;
  }

  describe('CSV import (readiness item C1)', () => {
    it('imports valid rows and reports what happened to each', async () => {
      const slugA = `import-atta-${unique()}`;
      const slugB = `import-rice-${unique()}`;

      const report = await importCsv(
        [
          CSV_HEADER,
          `${slugA},${uniqueName('Imported Atta 5kg')},${categorySlug},5,KG,1101,500,${uniqueEan()},true,ITC Limited,India,care@example.com,true`,
          `${slugB},${uniqueName('Imported Basmati Rice 1kg')},${categorySlug},1,KG,1006,500,${uniqueEan()},true,KRBL,India,care@example.com,true`,
        ].join('\n'),
      );

      expect(report.total).toBe(2);
      expect(report.created).toBe(2);
      expect(report.invalid).toBe(0);
      expect(report.rows.every((r) => r.outcome === 'CREATED')).toBe(true);
    });

    it('is idempotent — re-running the same file creates nothing', async () => {
      // Imports get re-run after a partial failure or a correction. A tool that
      // duplicates its own output on the second run is worse than none.
      const slug = `idempotent-${unique()}`;
      const name = uniqueName('Idempotent Dal 1kg');
      const row = `${slug},${name},${categorySlug},1,KG,0713,500,${uniqueEan()},true,Tata,India,care@example.com,true`;

      const first = await importCsv([CSV_HEADER, row].join('\n'));
      expect(first.created).toBe(1);

      const second = await importCsv([CSV_HEADER, row].join('\n'));
      expect(second.created).toBe(0);
      expect(second.unchanged).toBe(1);
    });

    it('flags a near-identical product as a duplicate instead of creating it', async () => {
      // One shared full-length token, so the pair resembles each other while
      // staying well clear of the products left behind by previous runs.
      const token = randomUUID();
      const baseName = `Sunfeast Marie Light 250g ${token}`;
      const variantName = `SUNFEAST MARIE LIGHT 250 G ${token}`;

      await importCsv(
        [
          CSV_HEADER,
          `dupe-base-${unique()},${baseName},${categorySlug},250,G,1905,1800,${uniqueEan()},true,ITC,India,care@example.com,true`,
        ].join('\n'),
      );

      // Same product, different capitalisation and spacing, no barcode — so
      // only name similarity can catch it.
      const report = await importCsv(
        [
          CSV_HEADER,
          `dupe-variant-${unique()},${variantName},${categorySlug},250,G,1905,1800,,true,ITC,India,care@example.com,true`,
        ].join('\n'),
      );

      expect(report.created).toBe(0);
      expect(report.duplicates).toBe(1);
      expect(report.rows[0]?.message).toContain('Sunfeast Marie Light');
    });

    it('treats an identical barcode as definitive', async () => {
      const ean = uniqueEan();
      await importCsv(
        [
          CSV_HEADER,
          `ean-base-${unique()},${uniqueName('Some Product 500g')},${categorySlug},500,G,2106,1200,${ean},true,X,India,care@example.com,true`,
        ].join('\n'),
      );

      const report = await importCsv(
        [
          CSV_HEADER,
          `ean-other-${unique()},${uniqueName('Zeta Unrelated Item')},${categorySlug},900,ML,2106,1200,${ean},true,X,India,care@example.com,true`,
        ].join('\n'),
      );

      expect(report.duplicates).toBe(1);
      expect(report.rows[0]?.message?.toLowerCase()).toContain('ean match');
    });

    it('reports invalid rows by spreadsheet row number without failing the batch', async () => {
      const good = `mixed-good-${unique()}`;
      const report = await importCsv(
        [
          CSV_HEADER,
          `${good},${uniqueName('Mixed Good Item 1kg')},${categorySlug},1,KG,1006,500,,true,X,India,care@example.com,true`,
          `mixed-bad-hsn-${unique()},${uniqueName('Bad HSN Item')},${categorySlug},1,KG,11,500,,true,X,India,care@example.com,true`,
          `mixed-bad-qty-${unique()},${uniqueName('Bad Quantity Item')},${categorySlug},0,KG,1006,500,,true,X,India,care@example.com,true`,
          `mixed-bad-cat-${unique()},${uniqueName('Unknown Category Item')},no-such-category,1,KG,1006,500,,true,X,India,care@example.com,true`,
        ].join('\n'),
      );

      expect(report.created).toBe(1);
      expect(report.invalid).toBe(3);

      // Row numbers must match what the operator sees in their spreadsheet.
      expect(report.rows.map((r) => r.row)).toEqual([2, 3, 4, 5]);
      expect(report.rows[1]?.message).toContain('hsn_code');
      expect(report.rows[2]?.message).toContain('net_quantity');
      expect(report.rows[3]?.message).toContain('Unknown category');
    });

    it('refuses a CSV missing a required column outright', async () => {
      const res = await http()
        .post('/admin/catalog/import')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ csv: 'slug,name\nfoo,Foo Product' })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('hsn_code');
    });

    it('denies import to a vendor', async () => {
      await http()
        .post('/admin/catalog/import')
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ csv: `${CSV_HEADER}\n` })
        .expect(403);
    });
  });

  describe('product-request queue (§1.9.1)', () => {
    let requestId: string;

    it('lets a vendor submit a product we do not have', async () => {
      const res = await http()
        .post(`/vendor/${vendorA}/product-requests`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({
          proposedName: `Regional Pickle ${unique()}`,
          proposedBrand: 'Local Brand',
          proposedNetQuantity: 500,
          proposedUom: Uom.G,
          proposedEanBarcode: uniqueEan(),
          desiredMrpPaise: 15000,
          desiredSellingPricePaise: 13500,
          desiredStockOnHand: 8,
        })
        .expect(201);

      const body = res.body as { request: { id: string; status: string } };
      expect(body.request.status).toBe('PENDING');
      requestId = body.request.id;
    });

    it('tells a vendor immediately when the barcode already exists', async () => {
      // Most requests are this case. Routing them through an admin queue would
      // drown the queue that matters.
      const ean = uniqueEan();
      await importCsv(
        [
          CSV_HEADER,
          `existing-${unique()},${uniqueName('Already Catalogued 1kg')},${categorySlug},1,KG,1006,500,${ean},true,X,India,care@example.com,true`,
        ].join('\n'),
      );

      const res = await http()
        .post(`/vendor/${vendorA}/product-requests`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ proposedName: 'Whatever They Called It', proposedEanBarcode: ean })
        .expect(409);

      expect(JSON.stringify(res.body)).toContain('already exists');
    });

    it("denies vendor A sight of vendor B's requests", async () => {
      await http()
        .get(`/vendor/${vendorB}/product-requests`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .expect(403);
    });

    it('shows the request in the admin queue', async () => {
      const res = await http()
        .get('/admin/catalog/product-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(requestId);
    });

    it('approves: creates the master product AND attaches the offer', async () => {
      const category = await http()
        .get('/admin/catalog/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const categoryId = (category.body as Array<{ id: string; slug: string }>).find(
        (c) => c.slug === categorySlug,
      )!.id;

      const res = await http()
        .post(`/admin/catalog/product-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `approved-pickle-${unique()}`,
          name: 'Regional Pickle 500g',
          categoryId,
          netQuantity: 500,
          uom: Uom.G,
          hsnCode: '2001',
          gstRateBp: GST_RATE_BP.TWELVE,
          isPrepackaged: true,
          manufacturerPacker: 'Local Foods',
          countryOfOrigin: 'India',
          consumerCareContact: 'care@local.example',
          activate: true,
        })
        .expect(201);

      const body = res.body as {
        request: { status: string; resolvedMasterProductId: string };
        product: { id: string };
        offer: { id: string; sellingPricePaise: number } | null;
      };

      expect(body.request.status).toBe('APPROVED');
      expect(body.request.resolvedMasterProductId).toBe(body.product.id);

      // The point of capturing price at request time: the vendor is not asked twice.
      expect(body.offer).not.toBeNull();
      expect(body.offer?.sellingPricePaise).toBe(13500);
    });

    it('refuses to re-resolve an already-resolved request', async () => {
      const res = await http()
        .post(`/admin/catalog/product-requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reviewerNotes: 'changed my mind' })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('already');
    });

    it('rejects as a duplicate and points the vendor at the real product', async () => {
      const submitted = await http()
        .post(`/vendor/${vendorA}/product-requests`)
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({ proposedName: `Duplicate Submission ${unique()}` })
        .expect(201);
      const id = (submitted.body as { request: { id: string } }).request.id;

      const products = await http()
        .get('/admin/catalog/products')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const existingProductId = (products.body as { items: Array<{ id: string }> })
        .items[0]!.id;

      const res = await http()
        .post(`/admin/catalog/product-requests/${id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reviewerNotes: 'We already stock this under another name',
          duplicateOfMasterProductId: existingProductId,
        })
        .expect(201);

      const body = res.body as { status: string; resolvedMasterProductId: string };
      expect(body.status).toBe('DUPLICATE');
      expect(body.resolvedMasterProductId).toBe(existingProductId);
    });
  });

  describe('the database constraint, not just the service check', () => {
    it('refuses an APPROVED request with nothing to point at', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into catalog.product_request
            (vendor_id, proposed_name, status, resolved_master_product_id)
          values
            ('${vendorA}', 'Orphaned approval', 'APPROVED', null)
        `),
      ).rejects.toThrow(/product_request_resolution_coherent/);
    });
  });
});
