import type { INestApplication } from '@nestjs/common';
import { Role } from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

export interface TestCustomer {
  token: string;
  accountId: string;
  phone: string;
  addressId: string;
}

/**
 * A shopper with no history, and an address near a store.
 *
 * ## Why a fresh one per order
 *
 * P3.4 made placement depend on the account's past: an order from somebody with
 * returned deliveries is held for confirmation instead of going to the store
 * (§2.10.4). Suites that manufacture failures — a delivery that fails, an RTO, a
 * return — and then keep ordering as the *same* customer were quietly building a
 * high-risk account, and their later orders stopped behaving like the ordinary
 * ones they were written to test.
 *
 * That was the scorer working correctly. The suites were the problem: they had
 * been sharing one customer because nothing used to read history.
 */
export async function createTestCustomer(
  app: INestApplication,
  location: { latitude: number; longitude: number },
  overrides: { pincode?: string } = {},
): Promise<TestCustomer> {
  const http = () => request(app.getHttpServer());

  // Digits, and unique: an address validates this as a phone number, and the
  // inbound WhatsApp webhook finds an order by matching what a reply came from.
  const phone = `+919${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;

  const signIn = await http()
    .post('/dev/login-as')
    .send({ role: Role.CUSTOMER, phone })
    .expect(201);
  const token = (signIn.body as { token: string }).token;

  const me = await http().get('/me').set('Authorization', `Bearer ${token}`).expect(200);

  const address = await http()
    .post('/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      label: 'HOME',
      recipientName: `Tester ${randomUUID().slice(0, 6)}`,
      recipientPhone: phone,
      line1: '42 Some Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: overrides.pincode ?? '560001',
      latitude: location.latitude,
      longitude: location.longitude,
    })
    .expect(201);

  return {
    token,
    phone,
    accountId: (me.body as { accountId: string }).accountId,
    addressId: (address.body as { id: string }).id,
  };
}
