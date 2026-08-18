import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, ScopeType, hasRoleAtVendor, type Principal } from '@freshkirana/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { closeDatabase, createDatabase } from '../../../db';
import { loadEnv } from '../../../config/env';
import { AccountRepository } from './account.repository';
import { SEED_VENDOR_A, SEED_VENDOR_B } from './dev-auth.service';

loadEnv();

/**
 * Is a migrated database reachable?
 *
 * These tests need one. Rather than failing the whole suite when Docker is not
 * running locally, they skip with a clear reason — unit tests stay runnable on
 * any machine. CI always provides the database, so they always execute there.
 */
async function databaseIsReachable(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const db = createDatabase();
    await db.execute('select 1 from identity.account limit 1');
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
    '\n  auth (e2e) SKIPPED - no migrated database.\n' +
      '  Run: npm run db:up && npm run build && npm run db:migrate\n',
  );
}

/**
 * End-to-end authentication and authorisation (spec §3.2).
 *
 * Requires a running database: `npm run db:up && npm run db:migrate`.
 */
describe.skipIf(!dbUp)('auth (e2e)', () => {
  let app: INestApplication;

  async function tokenFor(role: Role, vendorId?: string): Promise<string> {
    const body: Record<string, unknown> = { role };
    if (vendorId) body['vendorId'] = vendorId;

    const res = await request(app.getHttpServer())
      .post('/dev/login-as')
      .send(body)
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
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('deny-by-default', () => {
    it('rejects an unauthenticated request to a protected route', async () => {
      await request(app.getHttpServer()).get('/me').expect(401);
    });

    it('rejects a malformed authorization header', async () => {
      await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', 'Basic abc123')
        .expect(401);
    });

    it('rejects a forged token', async () => {
      await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('allows explicitly public routes', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('dev login', () => {
    it('issues a usable token with no OTP', async () => {
      const token = await tokenFor(Role.CUSTOMER);
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const principal = res.body as Principal;
      expect(principal.roles.some((r) => r.role === Role.CUSTOMER)).toBe(true);
    });

    it('rejects an unknown role', async () => {
      await request(app.getHttpServer())
        .post('/dev/login-as')
        .send({ role: 'WIZARD' })
        .expect(400);
    });

    it('scopes vendor roles to a vendor', async () => {
      const token = await tokenFor(Role.VENDOR_STAFF, SEED_VENDOR_A);
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const principal = res.body as Principal;

      // Assert the assignment *exists*, rather than that it is the first one.
      // Dev accounts are shared across suites and accumulate roles at several
      // vendors, so picking roles[0] would depend on test execution order.
      expect(
        principal.roles.some(
          (r) =>
            r.role === Role.VENDOR_STAFF &&
            r.scopeType === ScopeType.VENDOR &&
            r.scopeId === SEED_VENDOR_A,
        ),
      ).toBe(true);
    });
  });

  describe('concurrent account creation', () => {
    it('returns one account when the same phone is created simultaneously', async () => {
      // Check-then-insert used to race here: parallel test files hitting
      // dev/login-as for the same seeded phone produced a unique-violation 500
      // on a fresh database. Only CI caught it, because a database that already
      // had the accounts never entered the window.
      const repository = app.get(AccountRepository);
      const phone = `+9199${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`;

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          repository.createAccount({ phone, displayName: 'Race' }),
        ),
      );

      expect(new Set(results.map((r) => r.id)).size).toBe(1);
    });
  });

  describe('role authorisation', () => {
    it('denies a customer on an admin route', async () => {
      const token = await tokenFor(Role.CUSTOMER);
      await request(app.getHttpServer())
        .get('/admin/ping')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('allows an admin', async () => {
      const token = await tokenFor(Role.ADMIN);
      await request(app.getHttpServer())
        .get('/admin/ping')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('resource-level scoping (§3.2)', () => {
    it("denies vendor staff access to another vendor's scope", async () => {
      // The failure this prevents is vendor-to-vendor data leakage: the role is
      // identical at every store, so only the scope distinguishes them.
      const token = await tokenFor(Role.VENDOR_STAFF, SEED_VENDOR_A);
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const principal = res.body as Principal;

      expect(hasRoleAtVendor(principal, SEED_VENDOR_A, Role.VENDOR_STAFF)).toBe(true);
      expect(hasRoleAtVendor(principal, SEED_VENDOR_B, Role.VENDOR_STAFF)).toBe(false);
    });
  });
});
