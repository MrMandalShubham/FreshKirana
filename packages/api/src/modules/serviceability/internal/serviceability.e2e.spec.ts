import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Role,
  ServiceAreaMode,
  SlotStatus,
  StoredSlotStatus,
  istDateKey,
  istDayOfWeek,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { loadEnv } from '../../../config/env';
import { createDatabase } from '../../../db';
import { requireDatabase } from '../../../testing/database';
import { SlotService, type SlotView } from './slot.service';

loadEnv();

const dbUp = await requireDatabase('serviceability.service_area');

/**
 * Every run gets its own patch of the map.
 *
 * The database is shared and accumulates test stores, all of which are real
 * serviceable results. Pinning every suite to the same coordinates means a
 * "nearest stores" list eventually fills with branches from other suites and
 * earlier runs, and an assertion that *this* store appears starts failing for
 * reasons that have nothing to do with the code. Still inside the India
 * bounding box the schema enforces.
 */
const STORE = {
  latitude: 8 + Math.random() * 9,
  longitude: 70 + Math.random() * 14,
};

/** ~1.5 km north — inside a 3 km radius and inside the test polygon. */
const NEARBY = { latitude: STORE.latitude + 0.014, longitude: STORE.longitude };
/** ~110 km north. Outside everything in this suite. */
const FAR_AWAY = { latitude: STORE.latitude + 1, longitude: STORE.longitude };

/**
 * A square around the store, roughly 2.2 km on a side.
 *
 * GeoJSON is [longitude, latitude] — the opposite of how everyone says it —
 * and the ring must close by repeating its first point.
 */
const SQUARE_AROUND_STORE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [STORE.longitude - 0.01, STORE.latitude - 0.01],
      [STORE.longitude + 0.01, STORE.latitude - 0.01],
      [STORE.longitude + 0.01, STORE.latitude + 0.02],
      [STORE.longitude - 0.01, STORE.latitude + 0.02],
      [STORE.longitude - 0.01, STORE.latitude - 0.01],
    ],
  ],
};

describe.skipIf(!dbUp)('serviceability and slots (e2e)', () => {
  let app: INestApplication;
  let slotService: SlotService;

  let adminToken: string;
  let customerToken: string;

  /** Serves a polygon around the store. */
  let polygonVendor: string;
  /** Serves a 3 km radius from the same point. */
  let radiusVendor: string;
  /** Approved, but has drawn no service area at all. */
  let noAreaVendor: string;

  const unique = () => randomUUID().slice(0, 8);

  function http() {
    return request(app.getHttpServer());
  }

  async function createBranch(activate: boolean): Promise<string> {
    const res = await http()
      .post('/admin/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slug: `store-${unique()}`,
        legalName: 'Serviceability Test Traders',
        displayName: 'Test Store',
        phone: `+9198${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, '0')}`,
        addressLine: '1 Market Road',
        city: 'Bengaluru',
        pincode: '560001',
        fssaiLicenceNo: `1${Math.floor(Math.random() * 1e13)}`,
      })
      .expect(201);

    const id = (res.body as { id: string }).id;

    if (activate) {
      await http()
        .patch(`/admin/branches/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    }

    return id;
  }

  /** Not async: callers chain `.expect(...)` onto the supertest request. */
  function setRadiusArea(branchId: string, radiusMeters: number) {
    return http()
      .put(`/branch/${branchId}/service-area`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        mode: ServiceAreaMode.RADIUS,
        centreLatitude: STORE.latitude,
        centreLongitude: STORE.longitude,
        radiusMeters,
      });
  }

  /** A slot on a given date, far enough ahead that its cutoff has not passed. */
  async function defineSlotFor(
    branchId: string,
    dateKey: string,
    capacity: { picking: number; delivery: number },
    startMinute = 1_020, // 17:00 IST
  ) {
    return http()
      .put(`/branch/${branchId}/slot-definitions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dayOfWeek: istDayOfWeek(dateKey),
        startMinute,
        endMinute: startMinute + 120,
        pickingCapacityOrders: capacity.picking,
        deliveryCapacityOrders: capacity.delivery,
      })
      .expect(200);
  }

  /** Tomorrow in IST — always beyond any cutoff, whatever time the suite runs. */
  const tomorrow = () => istDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

  async function slotsFor(branchId: string): Promise<SlotView[]> {
    const res = await http()
      .get(`/serviceability/stores/${branchId}/slots`)
      .query({ days: 3 })
      .expect(200);
    return res.body as SlotView[];
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

    slotService = app.get(SlotService);

    const admin = await http()
      .post('/dev/login-as')
      .send({ role: Role.ADMIN })
      .expect(201);
    adminToken = (admin.body as { token: string }).token;

    const customer = await http()
      .post('/dev/login-as')
      .send({ role: Role.CUSTOMER })
      .expect(201);
    customerToken = (customer.body as { token: string }).token;

    polygonVendor = await createBranch(true);
    radiusVendor = await createBranch(true);
    noAreaVendor = await createBranch(true);

    await http()
      .put(`/branch/${polygonVendor}/service-area`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        mode: ServiceAreaMode.POLYGON,
        centreLatitude: STORE.latitude,
        centreLongitude: STORE.longitude,
        polygon: SQUARE_AROUND_STORE,
      })
      .expect(200);

    await setRadiusArea(radiusVendor, 3_000).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('addresses', () => {
    const validAddress = {
      label: 'HOME',
      recipientName: 'Test Recipient',
      recipientPhone: '+919812345678',
      line1: '42 Some Street',
      landmark: 'Opposite the temple',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      ...NEARBY,
    };

    async function createAddress(overrides: Record<string, unknown> = {}, expect = 201) {
      const res = await http()
        .post('/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ ...validAddress, ...overrides })
        .expect(expect);
      return res.body as { id: string; isDefault: boolean; label: string };
    }

    it('saves an address with its pin', async () => {
      const created = await createAddress();
      expect(created.id).toBeTruthy();
    });

    it('always has exactly one default', async () => {
      // An account with addresses and no default has no answer to "deliver
      // where?", and one with two has no answer either. The first address is
      // promoted whatever was ticked, and every later one keeps the count at 1.
      await createAddress();
      await createAddress({ label: 'WORK' });

      const list = await http()
        .get('/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const defaults = (list.body as Array<{ isDefault: boolean }>).filter(
        (a) => a.isDefault,
      );
      expect(defaults).toHaveLength(1);
    });

    it('moves the default rather than having two', async () => {
      const second = await createAddress({ label: 'WORK', isDefault: true });

      const list = await http()
        .get('/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const marked = (list.body as Array<{ id: string; isDefault: boolean }>).filter(
        (a) => a.isDefault,
      );
      expect(marked).toHaveLength(1);
      expect(marked[0]?.id).toBe(second.id);
    });

    it('rejects a swapped latitude and longitude', async () => {
      // Both values are individually valid. Only the India bounding box notices
      // that this pin is in the Sea of Japan.
      const res = await http()
        .post('/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ ...validAddress, latitude: 77.5946, longitude: 12.9716 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('swapped');
    });

    it('rejects a malformed pincode', async () => {
      await createAddress({ pincode: '060001' }, 400);
    });

    it('rejects a phone that is not an Indian mobile number', async () => {
      await createAddress({ recipientPhone: '9812345678' }, 400);
    });

    it("returns 404, not 403, for another account's address", async () => {
      const mine = await createAddress();

      const other = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_OWNER })
        .expect(201);

      // A 403 would confirm the address exists.
      await http()
        .get(`/me/addresses/${mine.id}`)
        .set('Authorization', `Bearer ${(other.body as { token: string }).token}`)
        .expect(404);
    });

    it('promotes the next address when the default is removed', async () => {
      const doomed = await createAddress({ isDefault: true });
      await createAddress({ label: 'OTHER' });

      await http()
        .delete(`/me/addresses/${doomed.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const list = await http()
        .get('/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const rows = list.body as Array<{ id: string; isDefault: boolean }>;
      expect(rows.some((a) => a.id === doomed.id)).toBe(false);
      expect(rows.filter((a) => a.isDefault)).toHaveLength(1);
    });

    it('requires a signed-in shopper', async () => {
      await http().get('/me/addresses').expect(401);
    });
  });

  describe('serviceability by polygon', () => {
    it('serves a pin inside the polygon', async () => {
      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      const body = res.body as {
        serviceable: boolean;
        stores: Array<{ branchId: string }>;
      };

      expect(body.serviceable).toBe(true);
      expect(body.stores.map((s) => s.branchId)).toContain(polygonVendor);
    });

    it('refuses a pin outside it', async () => {
      const res = await http().get('/serviceability/check').query(FAR_AWAY).expect(200);
      const body = res.body as { stores: Array<{ branchId: string }> };

      expect(body.stores.map((s) => s.branchId)).not.toContain(polygonVendor);
    });

    it('reads the polygon back as GeoJSON', async () => {
      // The raw geography column is a binary blob; a client that cannot read
      // its own service area cannot edit it.
      const res = await http()
        .get(`/branch/${polygonVendor}/service-area`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as {
        mode: string;
        polygon: { type: string; coordinates: number[][][] };
      };
      expect(body.mode).toBe(ServiceAreaMode.POLYGON);
      expect(body.polygon.type).toBe('Polygon');
      expect(body.polygon.coordinates[0]).toHaveLength(5);
    });

    it('refuses a polygon whose ring does not close', async () => {
      const res = await http()
        .put(`/branch/${polygonVendor}/service-area`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: ServiceAreaMode.POLYGON,
          centreLatitude: STORE.latitude,
          centreLongitude: STORE.longitude,
          polygon: {
            type: 'Polygon',
            coordinates: [
              [
                [77.5846, 12.9616],
                [77.6046, 12.9616],
                [77.6046, 12.9916],
              ],
            ],
          },
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toMatch(/four points|close/i);
    });

    it('refuses POLYGON mode with no polygon', async () => {
      await http()
        .put(`/branch/${polygonVendor}/service-area`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: ServiceAreaMode.POLYGON,
          centreLatitude: STORE.latitude,
          centreLongitude: STORE.longitude,
        })
        .expect(400);
    });
  });

  describe('serviceability by radius', () => {
    it('serves a pin inside the radius', async () => {
      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      const body = res.body as {
        stores: Array<{ branchId: string; distanceMeters: number }>;
      };

      const store = body.stores.find((s) => s.branchId === radiusVendor);
      expect(store).toBeDefined();
      // ~1.5 km north of the store, measured on the spheroid.
      expect(store!.distanceMeters).toBeGreaterThan(1_000);
      expect(store!.distanceMeters).toBeLessThan(2_000);
    });

    it('refuses a pin beyond it', async () => {
      // Shrink to 1 km and the same pin falls outside.
      await setRadiusArea(radiusVendor, 1_000).expect(200);

      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      expect(
        (res.body as { stores: Array<{ branchId: string }> }).stores.map(
          (s) => s.branchId,
        ),
      ).not.toContain(radiusVendor);

      await setRadiusArea(radiusVendor, 3_000).expect(200);
    });

    it('ranks nearer stores first', async () => {
      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      const distances = (
        res.body as { stores: Array<{ distanceMeters: number }> }
      ).stores.map((s) => s.distanceMeters);

      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it('refuses RADIUS mode with no radius', async () => {
      await http()
        .put(`/branch/${radiusVendor}/service-area`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: ServiceAreaMode.RADIUS,
          centreLatitude: STORE.latitude,
          centreLongitude: STORE.longitude,
        })
        .expect(400);
    });
  });

  describe('who is not offered', () => {
    it('never offers a store with no service area', async () => {
      // Failing closed: the alternative is promising delivery to an address no
      // rider can reach.
      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      expect(
        (res.body as { stores: Array<{ branchId: string }> }).stores.map(
          (s) => s.branchId,
        ),
      ).not.toContain(noAreaVendor);
    });

    it('never offers a store that is not approved, however close it is', async () => {
      const pending = await createBranch(false);
      await setRadiusArea(pending, 3_000).expect(200);

      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      expect(
        (res.body as { stores: Array<{ branchId: string }> }).stores.map(
          (s) => s.branchId,
        ),
      ).not.toContain(pending);
    });

    it('drops a store once its area is deactivated', async () => {
      const temporary = await createBranch(true);
      await setRadiusArea(temporary, 3_000).expect(200);

      await http()
        .put(`/branch/${temporary}/service-area`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: ServiceAreaMode.RADIUS,
          centreLatitude: STORE.latitude,
          centreLongitude: STORE.longitude,
          radiusMeters: 3_000,
          isActive: false,
        })
        .expect(200);

      const res = await http().get('/serviceability/check').query(NEARBY).expect(200);
      expect(
        (res.body as { stores: Array<{ branchId: string }> }).stores.map(
          (s) => s.branchId,
        ),
      ).not.toContain(temporary);
    });
  });

  describe('not serviceable yet', () => {
    it('answers 200 with an empty list, not an error', async () => {
      // "We don't deliver here" is information, not a failure.
      const res = await http().get('/serviceability/check').query(FAR_AWAY).expect(200);
      const body = res.body as { serviceable: boolean; waitlistAvailable: boolean };

      expect(body.serviceable).toBe(false);
      expect(body.waitlistAvailable).toBe(true);
    });

    it('captures the waitlist without an account', async () => {
      // The whole point is that this person cannot become a customer yet;
      // demanding a signup first loses exactly the signal §1.11 needs.
      const res = await http()
        .post('/serviceability/waitlist')
        .send({ ...FAR_AWAY, pincode: '570001', city: 'Mysuru' })
        .expect(201);

      expect((res.body as { id: string }).id).toBeTruthy();
    });

    it('rejects a waitlist entry with a malformed pincode', async () => {
      await http()
        .post('/serviceability/waitlist')
        .send({ ...FAR_AWAY, pincode: '5700' })
        .expect(400);
    });
  });

  describe('slots', () => {
    let slotVendor: string;

    beforeAll(async () => {
      slotVendor = await createBranch(true);
      await setRadiusArea(slotVendor, 3_000).expect(200);
      await defineSlotFor(slotVendor, tomorrow(), { picking: 3, delivery: 5 });
    });

    it('materialises a slot from the weekly definition on first read', async () => {
      // No nightly job: the slot exists because somebody looked for it.
      const slots = await slotsFor(slotVendor);
      expect(slots.length).toBeGreaterThan(0);
    });

    it('takes the smaller of picking and delivery capacity', async () => {
      // Picking 3, delivery 5 — three orders is the real limit.
      const slots = await slotsFor(slotVendor);
      expect(slots[0]?.capacity).toBe(3);
    });

    it('labels the window in local time', async () => {
      const slots = await slotsFor(slotVendor);
      expect(slots[0]?.label).toBe('17:00 – 19:00');
    });

    it('is stable on a second read rather than duplicating', async () => {
      const first = await slotsFor(slotVendor);
      const second = await slotsFor(slotVendor);
      expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
    });

    it('offers nothing for a store with no slot pattern', async () => {
      const slots = await slotsFor(noAreaVendor);
      expect(slots).toEqual([]);
    });
  });

  describe('capacity — the oversell condition', () => {
    let branchId: string;
    let slot: SlotView;

    beforeAll(async () => {
      branchId = await createBranch(true);
      await setRadiusArea(branchId, 3_000).expect(200);
      await defineSlotFor(branchId, tomorrow(), { picking: 5, delivery: 5 }, 900);

      const slots = await slotsFor(branchId);
      slot = slots[0]!;
    });

    it('greys out a full slot instead of hiding it', async () => {
      // §2.8.2: a disappearing slot reads as a bug; a greyed one reads as
      // information.
      for (let i = 0; i < 5; i += 1) {
        await slotService.book(slot.id);
      }

      const slots = await slotsFor(branchId);
      const full = slots.find((s) => s.id === slot.id);

      expect(full).toBeDefined();
      expect(full!.status).toBe(SlotStatus.FULL);
      expect(full!.isBookable).toBe(false);
      expect(full!.remaining).toBe(0);
    });

    it('refuses the sixth booking, naming the reason', async () => {
      await expect(slotService.book(slot.id)).rejects.toMatchObject({
        response: { code: 'SLOT_FULL' },
      });
    });

    it('frees a place on release', async () => {
      const released = await slotService.release(slot.id);
      expect(released.booked).toBe(4);
      expect(released.status).toBe(SlotStatus.OPEN);

      await slotService.book(slot.id);
    });

    it('lets exactly capacity through when everyone arrives at once', async () => {
      // The condition this whole model exists for: 20 checkouts racing for 5
      // places must produce 5 orders, not 20 promises the store cannot pack.
      const contested = await createBranch(true);
      await defineSlotFor(contested, tomorrow(), { picking: 5, delivery: 9 }, 780);

      const slots = await slotsFor(contested);
      const target = slots[0]!;
      expect(target.capacity).toBe(5);

      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, () => slotService.book(target.id)),
      );

      const succeeded = attempts.filter((a) => a.status === 'fulfilled').length;
      expect(succeeded).toBe(5);

      const after = await slotService.findSlot(target.id);
      expect(after.booked).toBe(5);
      expect(after.status).toBe(SlotStatus.FULL);
    });
  });

  describe('cutoffs and closures', () => {
    it('closes a slot once its cutoff has passed', async () => {
      // A slot starting 30 minutes from now, with a 90-minute cutoff, is
      // already past it — the store cannot pick an order that fast.
      const branchId = await createBranch(true);
      const now = new Date();
      const minuteOfDayIst = Math.floor(
        ((now.getTime() + 330 * 60_000) % (24 * 60 * 60_000)) / 60_000,
      );

      const startMinute = minuteOfDayIst + 30;
      // Skip near midnight, where +30 would spill into the next Indian day and
      // the slot would belong to a different service date entirely.
      if (startMinute + 120 >= 1_440) return;

      await http()
        .put(`/branch/${branchId}/slot-definitions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dayOfWeek: istDayOfWeek(istDateKey(now)),
          startMinute,
          endMinute: startMinute + 120,
          pickingCapacityOrders: 5,
          deliveryCapacityOrders: 5,
          cutoffMinutesBefore: 90,
        })
        .expect(200);

      const slots = await slotsFor(branchId);
      const today = slots.find((s) => s.serviceDate === istDateKey(now));

      expect(today).toBeDefined();
      expect(today!.status).toBe(SlotStatus.CLOSED);
      expect(today!.isBookable).toBe(false);

      await expect(slotService.book(today!.id)).rejects.toMatchObject({
        response: { code: 'SLOT_CLOSED' },
      });
    });

    it('blacks out a slot for a holiday', async () => {
      const branchId = await createBranch(true);
      await defineSlotFor(branchId, tomorrow(), { picking: 5, delivery: 5 }, 600);

      const slots = await slotsFor(branchId);
      const target = slots[0]!;

      await http()
        .patch(`/branch/${branchId}/slots/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: StoredSlotStatus.BLACKOUT })
        .expect(200);

      const after = await slotService.findSlot(target.id);
      expect(after.status).toBe(SlotStatus.BLACKOUT);

      await expect(slotService.book(target.id)).rejects.toMatchObject({
        response: { code: 'SLOT_BLACKOUT' },
      });
    });
  });

  describe('resource-level scoping (§3.2)', () => {
    it("denies one store's staff sight of another's slots", async () => {
      const staff = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_STAFF, branchId: polygonVendor })
        .expect(201);
      const staffToken = (staff.body as { token: string }).token;

      await http()
        .get(`/branch/${radiusVendor}/slots`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);

      await http()
        .get(`/branch/${polygonVendor}/slots`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);
    });

    it("denies writing another store's service area", async () => {
      const staff = await http()
        .post('/dev/login-as')
        .send({ role: Role.VENDOR_STAFF, branchId: polygonVendor })
        .expect(201);

      await http()
        .put(`/branch/${radiusVendor}/service-area`)
        .set('Authorization', `Bearer ${(staff.body as { token: string }).token}`)
        .send({
          mode: ServiceAreaMode.RADIUS,
          centreLatitude: STORE.latitude,
          centreLongitude: STORE.longitude,
          radiusMeters: 3_000,
        })
        .expect(403);
    });
  });

  describe('the database constraints, not just the service checks', () => {
    it('refuses to oversell a slot written directly to the table', async () => {
      const db = createDatabase();
      const branchId = randomUUID();
      const definitionId = randomUUID();

      await db.execute(`
        insert into serviceability.slot_definition
          (id, branch_id, day_of_week, start_minute, end_minute,
           picking_capacity_orders, delivery_capacity_orders, cutoff_minutes_before)
        values ('${definitionId}', '${branchId}', 1, 600, 720, 5, 5, 90)
      `);

      await expect(
        db.execute(`
          insert into serviceability.slot_instance
            (branch_id, slot_definition_id, service_date, starts_at, ends_at,
             capacity, booked, cutoff_minutes_before)
          values ('${branchId}', '${definitionId}', '2026-09-01',
                  '2026-09-01T04:30:00Z', '2026-09-01T06:30:00Z', 5, 6, 90)
        `),
      ).rejects.toThrow(/slot_instance_not_oversold/);
    });

    it('refuses a slot window that ends before it starts', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into serviceability.slot_definition
            (branch_id, day_of_week, start_minute, end_minute,
             picking_capacity_orders, delivery_capacity_orders)
          values ('${randomUUID()}', 1, 720, 600, 5, 5)
        `),
      ).rejects.toThrow(/slot_definition_window_is_ordered/);
    });

    it('refuses a service area whose mode nothing backs', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into serviceability.service_area
            (branch_id, mode, centre_latitude, centre_longitude)
          values ('${randomUUID()}', 'RADIUS', 12.97, 77.59)
        `),
      ).rejects.toThrow(/service_area_mode_is_backed/);
    });

    it('refuses an address pin outside India', async () => {
      const db = createDatabase();
      await expect(
        db.execute(`
          insert into "user".address
            (account_id, recipient_name, recipient_phone, line1, city, state,
             pincode, latitude, longitude)
          values ('${randomUUID()}', 'Test', '+919812345678', '1 Road',
                  'Bengaluru', 'Karnataka', '560001', 51.5074, 0.1278)
        `),
      ).rejects.toThrow(/address_(latitude|longitude)_in_range/);
    });
  });
});
