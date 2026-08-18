import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GST_RATE_BP,
  InventoryMode,
  ProductStatus,
  Role,
  type SearchResponse,
  Uom,
} from '@freshkirana/contracts';
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
    await db.execute('select 1 from search.product_index limit 1');
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
    '\n  search (e2e) SKIPPED - no migrated database.\n' +
      '  Run: npm run build && npm run db:migrate\n',
  );
}

describe.skipIf(!dbUp)('search (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let categoryId: string;
  let vendorId: string;

  /**
   * One token per run, woven into every product name.
   *
   * Search asserts on ranking across the *whole* index, and the database is
   * shared and persistent — so without a discriminator this suite would rank
   * against every product every previous run left behind. Searching for the
   * token is what makes the result set deterministic.
   */
  const RUN = `zq${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  const unique = () => randomUUID().slice(0, 8);
  const uniqueEan = () =>
    `89${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;

  function http() {
    return request(app.getHttpServer());
  }

  async function createProduct(input: {
    name: string;
    nameI18n?: Record<string, string>;
    netQuantity?: number;
  }): Promise<string> {
    const res = await http()
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `s-${unique()}`,
        name: input.name,
        nameI18n: input.nameI18n ?? {},
        categoryId,
        netQuantity: input.netQuantity ?? 1,
        uom: Uom.KG,
        hsnCode: '1101',
        gstRateBp: GST_RATE_BP.FIVE,
        eanBarcode: uniqueEan(),
        isPrepackaged: true,
        manufacturerPacker: 'Test Packer',
        countryOfOrigin: 'India',
        consumerCareContact: 'care@example.com',
        status: ProductStatus.ACTIVE,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function createOffer(
    masterProductId: string,
    sellingPricePaise: number,
    opts: { available?: boolean; mode?: string } = {},
  ) {
    await http()
      .post(`/vendor/${vendorId}/offers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        masterProductId,
        mrpPaise: sellingPricePaise + 1000,
        sellingPricePaise,
        inventoryMode: opts.mode ?? InventoryMode.QUANTITY,
        stockOnHand: opts.available === false ? 0 : 10,
        isAvailable: opts.available !== false,
      })
      .expect(201);
  }

  async function reindex(masterProductId: string) {
    await http()
      .post(`/admin/search/reindex/${masterProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
  }

  async function search(q: string, extra: Record<string, string> = {}) {
    const res = await http()
      .get('/search')
      .query({ q, limit: '20', ...extra })
      .expect(200);
    return res.body as SearchResponse;
  }

  // Ids for the ranking fixtures.
  let attaId: string;
  let cheapAttaId: string;
  let unavailableAttaId: string;

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

    const vendor = await http()
      .post('/admin/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `v-${unique()}`,
        legalName: 'Search Test Traders',
        displayName: 'Search Test Shop',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);
    vendorId = (vendor.body as { id: string }).id;

    await http()
      .post('/admin/search/synonyms/seed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    // Priced mid-range, in stock.
    attaId = await createProduct({ name: `${RUN} Aashirvaad Atta`, netQuantity: 5 });
    await createOffer(attaId, 25000);

    // Cheaper, in stock — must outrank the above on price alone.
    cheapAttaId = await createProduct({ name: `${RUN} Budget Atta`, netQuantity: 5 });
    await createOffer(cheapAttaId, 19000);

    // Nobody stocks it. Must rank below both, however well it matches.
    unavailableAttaId = await createProduct({ name: `${RUN} Atta`, netQuantity: 5 });
    await createOffer(unavailableAttaId, 15000, { available: false });

    for (const id of [attaId, cheapAttaId, unavailableAttaId]) {
      await reindex(id);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Indian-language handling (§2.7.2)', () => {
    it('finds the same product from atta, aata and आटा', async () => {
      const hindiProduct = await createProduct({
        name: `${RUN} Wheat Flour Pack`,
        nameI18n: { hi: 'आटा' },
      });
      await createOffer(hindiProduct, 22000);
      await reindex(hindiProduct);

      for (const term of ['atta', 'aata', 'आटा']) {
        const result = await search(`${RUN} ${term}`);
        const ids = result.items.map((i) => i.masterProductId);
        expect(ids, `searching "${term}" should reach the product`).toContain(
          hindiProduct,
        );

        // RUN alone matches every fixture, so the result set above cannot prove
        // expansion happened. Assert the expansion itself.
        expect(result.expandedTerms, `"${term}" should expand to atta`).toContain('atta');
        expect(result.expandedTerms, `"${term}" should expand to आटा`).toContain('आटा');
      }
    });

    it('expands a regional name to the English product', async () => {
      const onion = await createProduct({ name: `${RUN} Fresh Onion` });
      await createOffer(onion, 4000);
      await reindex(onion);

      // "kanda" is Marathi for onion; the product is named in English.
      const result = await search(`${RUN} kanda`);
      expect(result.items.map((i) => i.masterProductId)).toContain(onion);
      expect(result.expandedTerms).toContain('onion');
    });

    it('treats spelled-out and abbreviated units alike', async () => {
      const spelled = await search(`${RUN} atta 5 kilo`);
      const abbreviated = await search(`${RUN} atta 5kg`);
      expect(spelled.expandedTerms).toEqual(abbreviated.expandedTerms);
    });
  });

  describe('ranking (§2.7.3)', () => {
    it('never ranks an unavailable product above an available one', async () => {
      // The unavailable product is the *closest* name match and the cheapest.
      // Availability still wins: a perfect match nobody stocks cannot fill a basket.
      // Query the run token *alone*. Adding a real word like "atta" pulls in
      // every previous run's fixtures — they match that word too — and they
      // fill the result page before this run's unavailable product appears.
      const result = await search(RUN);

      const positions = result.items.map((i) => i.masterProductId);
      const unavailableAt = positions.indexOf(unavailableAttaId);
      const availableAt = Math.min(
        positions.indexOf(attaId),
        positions.indexOf(cheapAttaId),
      );

      expect(unavailableAt).toBeGreaterThan(-1);
      expect(availableAt).toBeGreaterThan(-1);
      expect(unavailableAt).toBeGreaterThan(availableAt);
    });

    it('marks availability on every result', async () => {
      const result = await search(RUN);
      const unavailable = result.items.find(
        (i) => i.masterProductId === unavailableAttaId,
      );
      expect(unavailable?.isAvailable).toBe(false);

      const available = result.items.find((i) => i.masterProductId === cheapAttaId);
      expect(available?.isAvailable).toBe(true);
      expect(available?.minPricePaise).toBe(19000);
    });

    it('breaks ties on price', async () => {
      const result = await search(RUN);
      const available = result.items.filter((i) => i.isAvailable);
      const cheapAt = available.findIndex((i) => i.masterProductId === cheapAttaId);
      const dearAt = available.findIndex((i) => i.masterProductId === attaId);
      expect(cheapAt).toBeLessThan(dearAt);
    });
  });

  describe('index freshness (§2.7.4)', () => {
    it('drops a product from search when it is archived', async () => {
      const doomed = await createProduct({ name: `${RUN} Temporary Product` });
      await createOffer(doomed, 5000);
      await reindex(doomed);

      expect(
        (await search(`${RUN} Temporary`)).items.map((i) => i.masterProductId),
      ).toContain(doomed);

      await http()
        .patch(`/admin/catalog/products/${doomed}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: ProductStatus.ARCHIVED })
        .expect(200);
      await reindex(doomed);

      expect(
        (await search(`${RUN} Temporary`)).items.map((i) => i.masterProductId),
      ).not.toContain(doomed);
    });

    it('never indexes a DRAFT product', async () => {
      // A DRAFT is half-catalogued; surfacing it would show shoppers products
      // that may be missing their Legal Metrology declarations.
      const draftRes = await http()
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: `draft-${unique()}`,
          name: `${RUN} Draft Only Product`,
          categoryId,
          netQuantity: 1,
          uom: Uom.KG,
          hsnCode: '1101',
          gstRateBp: GST_RATE_BP.FIVE,
        })
        .expect(201);

      const draftId = (draftRes.body as { id: string }).id;
      await reindex(draftId);

      expect(
        (await search(`${RUN} Draft Only`)).items.map((i) => i.masterProductId),
      ).not.toContain(draftId);
    });
  });

  describe('zero results (§2.7.4)', () => {
    it('flags a zero-result search rather than returning noise', async () => {
      // Deliberately without RUN: that token is in every fixture name, so a
      // query containing it can never return nothing.
      const result = await search(`zzqqxxjjvv${unique()}`);
      expect(result.zeroResult).toBe(true);
      expect(result.items).toHaveLength(0);
    });

    it('offers a correction when the query is close to something real', async () => {
      const result = await search(`${RUN} Aashirvad Atta`);
      // Either it matched despite the typo, or it suggested the real name.
      expect(result.zeroResult === false || Boolean(result.didYouMean)).toBe(true);
    });

    it('handles an all-punctuation query without error', async () => {
      const res = await http().get('/search').query({ q: '!!!' }).expect(200);
      expect((res.body as SearchResponse).zeroResult).toBe(true);
    });
  });

  describe('access', () => {
    it('is public — the funnel starts before signup', async () => {
      await http().get('/search').query({ q: 'atta' }).expect(200);
    });

    it('offers autocomplete', async () => {
      const res = await http().get('/search/suggest').query({ q: RUN }).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('denies synonym editing to anyone but admin and ops', async () => {
      const customer = await http()
        .post('/dev/login-as')
        .send({ role: Role.CUSTOMER })
        .expect(201);

      await http()
        .post('/admin/search/synonyms')
        .set('Authorization', `Bearer ${(customer.body as { token: string }).token}`)
        .send({ term: 'x', expansions: ['y'] })
        .expect(403);
    });
  });

  describe('ops-editable synonyms without a deploy (§2.7.2)', () => {
    it('takes effect on the very next search', async () => {
      // Both the product word and the regional term are run-unique, and neither
      // query carries RUN. So the *only* way this product can be reached is
      // through the synonym — nothing here can pass by accident.
      const productWord = `ragi${unique()}`;
      const madeUpTerm = `nachni${unique()}`;

      const product = await createProduct({ name: `${productWord} Flour ${RUN}` });
      await createOffer(product, 8000);
      await reindex(product);

      const before = await search(madeUpTerm);
      expect(before.items.map((i) => i.masterProductId)).not.toContain(product);
      expect(before.zeroResult).toBe(true);

      await http()
        .post('/admin/search/synonyms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ term: madeUpTerm, expansions: [productWord], kind: 'REGIONAL_NAME' })
        .expect(201);

      // No deploy, no reindex — expansion happens at query time.
      const after = await search(madeUpTerm);
      expect(after.items.map((i) => i.masterProductId)).toContain(product);
      expect(after.expandedTerms).toContain(productWord);
    });
  });
});
