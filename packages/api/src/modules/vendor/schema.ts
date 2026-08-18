import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables owned by the vendor module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 */
export const vendorSchema = pgSchema('vendor');

/**
 * A shop on the marketplace (spec §1.5.2, §2.2).
 *
 * Staff membership is deliberately *not* here: it lives in the identity module
 * as a vendor-scoped role assignment (§3.2), so there is exactly one place that
 * answers "who may act as this vendor".
 *
 * Bank details are also absent by design — they arrive with settlement (P5.3),
 * and there is no reason to hold that data before anything can pay out.
 */
export const vendor = vendorSchema.table(
  'vendor',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),

    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),

    phone: text('phone').notNull(),
    email: text('email'),

    addressLine: text('address_line').notNull(),
    city: text('city').notNull(),
    pincode: text('pincode').notNull(),

    /**
     * GST posture (§3.7.1). A composition or exempt vendor invoices
     * differently, so the declaration is captured at onboarding rather than
     * inferred from whether a GSTIN happens to be present.
     */
    gstRegistrationType: text('gst_registration_type').notNull().default('UNREGISTERED'),
    gstin: text('gstin'),

    /**
     * FSSAI licence (§3.7.3). Expiry is tracked because an expired licence must
     * auto-suspend the store's listings — the reminder job lands with admin ops.
     */
    fssaiLicenceNo: text('fssai_licence_no'),
    fssaiExpiryDate: date('fssai_expiry_date'),

    /** Default for new offers; each offer may still declare its own (§1.9.2). */
    defaultInventoryMode: text('default_inventory_mode').notNull().default('TOGGLE'),

    /** PENDING | ACTIVE | SUSPENDED — only ACTIVE vendors may sell. */
    status: text('status').notNull().default('PENDING'),
    suspensionReason: text('suspension_reason'),

    /** Operating hours, service radius etc. Firmed up by serviceability (P2.2). */
    storeConfig: jsonb('store_config').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('vendor_slug_key').on(table.slug),
    index('vendor_status_idx').on(table.status),
    index('vendor_pincode_idx').on(table.pincode),

    /**
     * A GST-registered vendor must actually have a GSTIN.
     *
     * The invoice is issued under the *vendor's* GSTIN (§3.7.1), so a vendor
     * claiming registration without one would produce an unissuable invoice at
     * the first order.
     */
    check(
      'vendor_gstin_present_when_registered',
      sql`${table.gstRegistrationType} <> 'REGISTERED' or (${table.gstin} is not null and btrim(${table.gstin}) <> '')`,
    ),

    // 15 characters, the standard GSTIN shape.
    check(
      'vendor_gstin_shape',
      sql`${table.gstin} is null or ${table.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'`,
    ),

    check('vendor_pincode_shape', sql`${table.pincode} ~ '^[1-9][0-9]{5}$'`),

    /**
     * An ACTIVE food vendor must hold an FSSAI licence (§3.7.3). Capturing it
     * at onboarding is the whole point; enforcing it here means a vendor cannot
     * be flipped live without one.
     */
    check(
      'vendor_fssai_required_when_active',
      sql`${table.status} <> 'ACTIVE' or (${table.fssaiLicenceNo} is not null and btrim(${table.fssaiLicenceNo}) <> '')`,
    ),
  ],
);

export type VendorRow = typeof vendor.$inferSelect;
export type NewVendorRow = typeof vendor.$inferInsert;
