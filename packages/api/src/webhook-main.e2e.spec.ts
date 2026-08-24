import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from './config/env';
import { requireDatabase } from './testing/database';
import {
  PUBLIC_WEBHOOK_PATHS,
  createWebhookApp,
  isPubliclyReachable,
} from './webhook-main';

loadEnv();

const dbUp = await requireDatabase('"order"."order"');

/**
 * What the public webhook service will and will not answer.
 *
 * This is the test that keeps the private API private. The service is reachable
 * by anyone on the internet — it has to be, because Razorpay and the WhatsApp
 * BSP are anonymous callers — and it runs the *same image* as the API, with the
 * whole application graph loaded. Only a middleware stands between an internet
 * caller and every customer, cart and admin route in the product.
 *
 * So the assertions below are not paperwork. If one of them ever fails, this
 * deployment has been widened and the API's IAM privacy has been undone in
 * practice while still looking correct in Terraform.
 */
describe.skipIf(!dbUp)('the public webhook service', () => {
  let app: INestApplication;

  function http() {
    return request(app.getHttpServer());
  }

  beforeAll(async () => {
    app = await createWebhookApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('what it answers', () => {
    it('accepts the payment webhook', async () => {
      // Unsigned, so it is refused on its merits — but it is *reached*, which
      // is what this asserts. A 404 here would mean Razorpay cannot pay us.
      const res = await http()
        .post('/webhooks/razorpay')
        .set('content-type', 'application/json')
        .send('{}')
        .expect(201);

      expect((res.body as { reason: string }).reason).toBe('INVALID_SIGNATURE');
    });

    it('accepts the WhatsApp webhook', async () => {
      const res = await http()
        .post('/webhooks/whatsapp')
        .send({ nonsense: true })
        .expect(201);
      expect((res.body as { handled: boolean }).handled).toBe(false);
    });

    it('answers the startup probe', async () => {
      await http().get('/health').expect(200);
    });
  });

  describe('what it hides', () => {
    /**
     * A sample across every audience. Not exhaustive — it cannot be — but each
     * one is a route that would leak or change real data if it were reachable
     * by an anonymous caller.
     */
    const mustNotBeReachable: Array<[string, string]> = [
      ['GET', '/me/orders'],
      ['GET', '/me/addresses'],
      ['GET', '/me/notifications'],
      ['GET', '/me/usual-basket'],
      ['GET', '/cart'],
      ['POST', '/cart/items'],
      ['POST', '/checkout/place'],
      ['GET', '/admin/branches'],
      ['POST', '/dev/login-as'],
      ['GET', '/catalog/categories'],
      ['GET', '/search'],
      ['POST', '/internal/branch-sla/sweep'],
      ['POST', '/internal/payments/reconcile'],
      ['GET', '/metrics'],
    ];

    it.each(mustNotBeReachable)('%s %s is not found', async (method, path) => {
      const res = await (method === 'GET'
        ? http().get(path)
        : http().post(path).send({}));

      // 404 rather than 401 or 403: a 403 confirms the route exists, which
      // tells an anonymous caller what this deployment is running.
      expect(res.status).toBe(404);
    });

    it('is not fooled by a query string', async () => {
      await http().get('/me/orders?x=/webhooks/razorpay').expect(404);
    });

    it('is not fooled by a trailing slash', async () => {
      await http().get('/me/orders/').expect(404);
    });

    it('does not open a path merely because it starts with an allowed one', async () => {
      // `/webhooks/razorpay-something-else` must not inherit the allowance.
      await http().post('/webhooks/razorpay/extra').send({}).expect(404);
    });
  });

  describe('the allowlist itself', () => {
    it('matches exactly, not by prefix', () => {
      expect(isPubliclyReachable('/webhooks/razorpay')).toBe(true);
      expect(isPubliclyReachable('/webhooks/razorpayX')).toBe(false);
      expect(isPubliclyReachable('/webhooks')).toBe(false);
      expect(isPubliclyReachable('/')).toBe(false);
    });

    it('stays small', () => {
      // A growing list is the thing to notice. Every entry here is a route the
      // whole internet can reach, and each needs its own reason.
      expect(PUBLIC_WEBHOOK_PATHS.length).toBeLessThanOrEqual(4);
    });
  });
});
