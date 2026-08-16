import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnalyticsEvent, Platform } from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { closeDatabase, createDatabase } from '../../../db';
import { CORRELATION_HEADER } from '../../../observability/correlation';

loadEnv();

async function databaseIsReachable(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const db = createDatabase();
    await db.execute('select 1 from analytics.event limit 1');
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
    '\n  analytics (e2e) SKIPPED - no migrated database.\n' +
      '  Run: npm run db:up && npm run build && npm run db:migrate\n',
  );
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    event: AnalyticsEvent.ADD_TO_CART,
    occurredAt: new Date().toISOString(),
    anonId: 'anon-test-1',
    sessionId: 'session-test-1',
    platform: Platform.WEB,
    properties: { source: 'usual_basket', itemCount: 3 },
    ...overrides,
  };
}

describe.skipIf(!dbUp)('analytics ingest (e2e)', () => {
  let app: INestApplication;

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

  it('accepts a declared event anonymously', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent())
      .expect(202);

    expect(res.body).toEqual({ accepted: true, duplicate: false });
  });

  it('drops a duplicate rather than double-counting it', async () => {
    const payload = validEvent();
    await request(app.getHttpServer()).post('/events').send(payload).expect(202);

    const second = await request(app.getHttpServer())
      .post('/events')
      .send(payload)
      .expect(202);

    expect(second.body).toEqual({ accepted: true, duplicate: true });
  });

  it('rejects an undeclared event (rule R1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent({ event: 'someone_invented_this' }))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('R1');
  });

  it('rejects personal data in properties (§5.3)', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent({ properties: { phone: '+919000000001' } }))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('phone');
  });

  it('rejects personal data nested in properties', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send(validEvent({ properties: { customer: { email: 'a@b.com' } } }))
      .expect(400);
  });

  it('accepts a batch and reports per-event outcomes', async () => {
    const res = await request(app.getHttpServer())
      .post('/events/batch')
      .send({ events: [validEvent(), validEvent({ event: 'not_a_real_event' })] })
      .expect(202);

    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
  });

  it('echoes a correlation id on every response', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set(CORRELATION_HEADER, 'trace-me-12345')
      .expect(200);

    expect(res.headers[CORRELATION_HEADER]).toBe('trace-me-12345');
  });

  it('mints a correlation id when the client sends none', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers[CORRELATION_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes Prometheus metrics including request counters', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('analytics_events_ingested_total');
  });
});
