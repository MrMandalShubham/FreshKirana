import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the serviceability module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const serviceabilitySchema = pgSchema('serviceability');

/**
 * A PostGIS polygon in WGS 84, stored as `geography` rather than `geometry`.
 *
 * `geography` measures in metres on the actual spheroid. With `geometry` the
 * same query measures in *degrees*, and a degree of longitude is 111 km at the
 * equator and 0 km at the pole — so a "5 km radius" would silently mean
 * different things in Chennai and Srinagar.
 *
 * Drizzle has no PostGIS types, so reads go through `ST_AsGeoJSON` and writes
 * through `ST_GeomFromGeoJSON` — never this column directly.
 */
const geographyPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Polygon,4326)',
});

/**
 * Where a store will deliver (spec §2.8.1).
 *
 * A polygon is preferred because real delivery boundaries follow roads, rivers
 * and railway lines. The radius fallback exists so a vendor can be live the day
 * they sign up — a pin and "about 3 km" takes thirty seconds, and waiting for a
 * drawn polygon would keep them off the platform entirely.
 *
 * A vendor with no service area serves **nobody**. Failing closed is the only
 * safe default: the alternative is promising delivery to an address no rider
 * can reach.
 */
export const serviceArea = serviceabilitySchema.table(
  'service_area',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by the vendor module. Validated through its contracts, never joined. */
    vendorId: uuid('vendor_id').notNull(),

    /** POLYGON | RADIUS — which of the two below is authoritative. */
    mode: text('mode').notNull().default('RADIUS'),

    polygon: geographyPolygon('polygon'),

    /** The store's own pin. Also the origin for distance ranking. */
    centreLatitude: doublePrecision('centre_latitude').notNull(),
    centreLongitude: doublePrecision('centre_longitude').notNull(),
    radiusMeters: integer('radius_meters'),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // One service area per store. Two would mean two answers to "do you
    // deliver here", and no rule for which wins.
    uniqueIndex('service_area_vendor_key').on(table.vendorId),

    check(
      'service_area_mode_is_backed',
      sql`(${table.mode} = 'POLYGON' and ${table.polygon} is not null)
          or (${table.mode} = 'RADIUS' and ${table.radiusMeters} is not null and ${table.radiusMeters} > 0)`,
    ),
    check(
      'service_area_centre_in_range',
      sql`${table.centreLatitude} >= 6 and ${table.centreLatitude} <= 38
          and ${table.centreLongitude} >= 68 and ${table.centreLongitude} <= 98`,
    ),
  ],
);

/**
 * A recurring delivery window a store offers (spec §2.8.2).
 *
 * Times are **minutes from midnight IST** rather than a `time` column: slot
 * arithmetic is all addition and comparison, and integers make the cutoff
 * calculation obvious instead of a timezone question. India has one time zone
 * and no daylight saving, so the conversion is a fixed offset — see
 * `istInstant` in contracts, which is the only place that knows this.
 */
export const slotDefinition = serviceabilitySchema.table(
  'slot_definition',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    vendorId: uuid('vendor_id').notNull(),

    /** 0 = Sunday, matching JavaScript's `getUTCDay`. */
    dayOfWeek: integer('day_of_week').notNull(),

    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),

    /**
     * Both capacities are modelled because the real limit is the smaller of
     * them (§2.8.2). Tracking only picking is how a store ends up with eight
     * orders it can pack and two riders to deliver them.
     */
    pickingCapacityOrders: integer('picking_capacity_orders').notNull(),
    deliveryCapacityOrders: integer('delivery_capacity_orders').notNull(),

    /** The slot stops accepting orders this many minutes before it starts. */
    cutoffMinutesBefore: integer('cutoff_minutes_before').notNull().default(90),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('slot_definition_window_key').on(
      table.vendorId,
      table.dayOfWeek,
      table.startMinute,
    ),
    index('slot_definition_vendor_idx').on(table.vendorId),

    check('slot_definition_day_of_week', sql`${table.dayOfWeek} between 0 and 6`),
    check(
      'slot_definition_window_is_ordered',
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440 and ${table.startMinute} < ${table.endMinute}`,
    ),
    check(
      'slot_definition_capacity_not_negative',
      sql`${table.pickingCapacityOrders} >= 0 and ${table.deliveryCapacityOrders} >= 0`,
    ),
    check('slot_definition_cutoff_not_negative', sql`${table.cutoffMinutesBefore} >= 0`),
  ],
);

/**
 * One dated instance of a slot — the thing an order actually books.
 *
 * Instances are materialised **lazily, on read**, from the definitions. A
 * nightly job would be a scheduler to run, monitor and back-fill after every
 * outage; generating on demand means a slot exists exactly when somebody looks
 * for it, and the unique key below makes concurrent generation harmless.
 *
 * `status` holds only what a person decided: OPEN, CLOSED, BLACKOUT. **FULL is
 * derived** from `booked >= capacity` — storing it would be a second source of
 * truth that every release path has to remember to undo.
 */
export const slotInstance = serviceabilitySchema.table(
  'slot_instance',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    vendorId: uuid('vendor_id').notNull(),
    slotDefinitionId: uuid('slot_definition_id')
      .notNull()
      .references(() => slotDefinition.id, { onDelete: 'cascade' }),

    /** The Indian calendar date this slot serves. */
    serviceDate: date('service_date').notNull(),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

    /** Frozen at materialisation, so editing a definition cannot shrink a slot
     *  people have already booked into. */
    capacity: integer('capacity').notNull(),
    booked: integer('booked').notNull().default(0),
    cutoffMinutesBefore: integer('cutoff_minutes_before').notNull(),

    /** OPEN | CLOSED | BLACKOUT. Never FULL — that is computed. */
    status: text('status').notNull().default('OPEN'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // The key that makes lazy materialisation safe: two requests racing to
    // create the same slot produce one row, not two.
    uniqueIndex('slot_instance_date_key').on(table.slotDefinitionId, table.serviceDate),
    index('slot_instance_vendor_date_idx').on(table.vendorId, table.serviceDate),

    /**
     * The oversell condition, enforced by the database.
     *
     * The booking statement already refuses to increment past capacity, but a
     * service check is a promise and a CHECK is a guarantee — and this is the
     * constraint that decides whether a shopper is told "no" now or a vendor
     * is told "sorry" at 7pm.
     */
    check(
      'slot_instance_not_oversold',
      sql`${table.booked} between 0 and ${table.capacity}`,
    ),
    check('slot_instance_capacity_not_negative', sql`${table.capacity} >= 0`),
    check('slot_instance_window_is_ordered', sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

/**
 * Someone we cannot serve yet (spec §2.8.1, §1.11).
 *
 * This is the primary input to expansion decisions — where demand exists
 * before supply does. It is deliberately capturable without an account,
 * because the whole point is that this person cannot become a customer yet.
 */
export const waitlistEntry = serviceabilitySchema.table(
  'waitlist_entry',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Null when they never signed up — which is the common case. */
    accountId: uuid('account_id'),

    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    pincode: text('pincode').notNull(),
    city: text('city'),

    /** How to tell them we have arrived. Optional: asking is not requiring. */
    contactPhone: text('contact_phone'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('waitlist_pincode_idx').on(table.pincode),
    check('waitlist_pincode_format', sql`${table.pincode} ~ '^[1-9][0-9]{5}$'`),
  ],
);

export type ServiceAreaRow = typeof serviceArea.$inferSelect;
export type SlotDefinitionRow = typeof slotDefinition.$inferSelect;
export type SlotInstanceRow = typeof slotInstance.$inferSelect;
export type WaitlistEntryRow = typeof waitlistEntry.$inferSelect;
