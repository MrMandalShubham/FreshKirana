import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the user module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const userSchema = pgSchema('user');

/**
 * A delivery address (spec §1.5.1, §2.2, §2.8.1).
 *
 * ## Coordinates are the source of truth, not the text
 *
 * Serviceability is decided by the pin, not by the typed address: Indian
 * addresses are unreliable as text — the same building appears as four
 * different strings, and the pincode alone spans several kilometres. So
 * `latitude`/`longitude` are required and not nullable.
 *
 * There is deliberately no PostGIS column here. Nothing queries *addresses*
 * spatially — the geometry lives on the store's service area, and a check
 * builds the customer's point inline from these two numbers. A derived column
 * with no reader is a thing to keep in sync for nothing.
 *
 * ## No geocoder
 *
 * The client supplies the pin from a map or the device. Wiring a paid geocoding
 * API is a program decision, not a build one, and the seam is here: whoever
 * adds it fills these two columns before insert and nothing else changes.
 */
export const address = userSchema.table(
  'address',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Owned by identity. Validated through its contracts, never joined. */
    accountId: uuid('account_id').notNull(),

    /** HOME | WORK | OTHER — what the shopper calls it. */
    label: text('label').notNull().default('HOME'),

    /**
     * Who receives the order, which is often not the account holder — a parent,
     * a spouse, the guard at the gate. The rider calls this number, so it is
     * captured per address rather than taken from the account.
     */
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),

    line1: text('line1').notNull(),
    line2: text('line2'),
    /** How Indian addresses are actually found. Not decoration. */
    landmark: text('landmark'),

    city: text('city').notNull(),
    state: text('state').notNull(),
    pincode: text('pincode').notNull(),

    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),

    /** Delivery instructions the rider sees. "Ring twice", "gate code 4412". */
    deliveryNote: text('delivery_note'),

    isDefault: boolean('is_default').notNull().default(false),

    /**
     * Soft delete. A placed order references the address it was delivered to,
     * and a shopper removing an address must not erase where last month's order
     * went — §3.6 erasure is a separate, deliberate process.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('address_account_idx').on(table.accountId),

    // At most one default per account, ignoring deleted rows. Partial, because
    // two soft-deleted defaults are harmless history.
    uniqueIndex('address_one_default_key')
      .on(table.accountId)
      .where(sql`${table.isDefault} and ${table.deletedAt} is null`),

    // A swapped latitude/longitude is valid on both axes and lands in the sea.
    // The bounding box is generous on purpose: it rejects the bug, not the
    // customer (see isPlausiblyInIndia in contracts).
    check(
      'address_latitude_in_range',
      sql`${table.latitude} >= 6 and ${table.latitude} <= 38`,
    ),
    check(
      'address_longitude_in_range',
      sql`${table.longitude} >= 68 and ${table.longitude} <= 98`,
    ),
    check('address_pincode_format', sql`${table.pincode} ~ '^[1-9][0-9]{5}$'`),
  ],
);

export type AddressRow = typeof address.$inferSelect;
