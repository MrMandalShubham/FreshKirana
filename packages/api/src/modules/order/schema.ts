import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
 * Tables owned by the order module.
 *
 * No other module may read or write these. Enforced by
 * scripts/check-schema-ownership.mjs and dependency-cruiser.
 *
 * `order` is a SQL reserved word. Drizzle always quotes identifiers so this is
 * safe, but hand-written psql needs `"order"."order"`.
 */
export const orderSchema = pgSchema('order');

/**
 * A placed order — the canonical record (spec §2.6.1, §2.2).
 *
 * ## Everything is snapshotted
 *
 * The delivery address, the slot window, the product names and the prices are
 * all copied in rather than referenced. A customer may edit or delete an
 * address tomorrow, a vendor may re-price or delist an offer tonight, and the
 * order must still say what was agreed. An order that changes retroactively is
 * an order nobody can support, invoice or audit.
 *
 * ## Two orthogonal statuses
 *
 * `status` is fulfilment progress, `paymentStatus` is money (§2.6.2). A COD
 * order is delivered long before it is captured, and a delivered order can be
 * refunded — conflating them is the classic marketplace modelling mistake.
 */
export const order = orderSchema.table(
  'order',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Read over the phone, written on a packing slip: `FK-260818-00042`. */
    orderNumber: text('order_number').notNull(),

    /** Owned by identity. Validated through contracts, never joined. */
    accountId: uuid('account_id').notNull(),
    /** Owned by vendor. One order, one store — decision D2. */
    vendorId: uuid('vendor_id').notNull(),

    /**
     * The cart this came from.
     *
     * Unique, which is what makes placing an order idempotent: a double-tapped
     * "Place order" finds the existing row and returns it rather than creating
     * a second order the customer never intended.
     */
    cartId: uuid('cart_id').notNull(),

    status: text('status').notNull(),
    paymentStatus: text('payment_status').notNull(),
    paymentMethod: text('payment_method').notNull(),

    /** AUTO_SUBSTITUTE | ASK_ME | REFUND_ITEM (§1.7.2). */
    substitutionPreference: text('substitution_preference').notNull(),

    // --- Delivery address, frozen at placement -----------------------------
    addressId: uuid('address_id').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    addressLandmark: text('address_landmark'),
    addressCity: text('address_city').notNull(),
    addressState: text('address_state').notNull(),
    addressPincode: text('address_pincode').notNull(),
    addressLatitude: doublePrecision('address_latitude').notNull(),
    addressLongitude: doublePrecision('address_longitude').notNull(),
    deliveryNote: text('delivery_note'),

    // --- Slot, frozen at placement -----------------------------------------
    slotInstanceId: uuid('slot_instance_id').notNull(),
    slotServiceDate: date('slot_service_date').notNull(),
    slotStartsAt: timestamp('slot_starts_at', { withTimezone: true }).notNull(),
    slotEndsAt: timestamp('slot_ends_at', { withTimezone: true }).notNull(),

    // --- Money. Integer paise throughout (§2.3) ----------------------------
    itemsSubtotalPaise: integer('items_subtotal_paise').notNull(),
    savingsPaise: integer('savings_paise').notNull().default(0),
    deliveryFeePaise: integer('delivery_fee_paise').notNull().default(0),
    smallBasketFeePaise: integer('small_basket_fee_paise').notNull().default(0),
    packagingFeePaise: integer('packaging_fee_paise').notNull().default(0),
    grandTotalPaise: integer('grand_total_paise').notNull(),

    /**
     * Tax *within* the total, not added to it (§3.7.1).
     *
     * Indian retail prices are GST-inclusive, so this is extracted from
     * `grandTotalPaise` rather than summed onto it. Stored because the rates
     * that produced it can change in the catalog tomorrow.
     */
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),

    /**
     * What the rider collects at the door. Zero for a prepaid order.
     *
     * Separate from `grandTotalPaise` because the two diverge as soon as
     * variable weights (P4.2) or partial refunds enter the picture — the rider
     * needs one number, and it is this one.
     */
    codCollectablePaise: integer('cod_collectable_paise').notNull().default(0),

    placedAt: timestamp('placed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('order_number_key').on(table.orderNumber),
    uniqueIndex('order_cart_key').on(table.cartId),

    index('order_account_idx').on(table.accountId, table.placedAt),
    index('order_vendor_idx').on(table.vendorId, table.status),
    index('order_slot_idx').on(table.slotInstanceId),

    /**
     * The total must be the sum of its parts.
     *
     * Not a formality: this is the number a customer pays and a vendor is
     * settled against, and every later part — refunds, substitutions, actual
     * weights — edits these columns. A drift of one paisa here becomes a
     * reconciliation exception in §2.11 that somebody has to chase by hand.
     */
    check(
      'order_total_is_the_sum_of_its_parts',
      sql`${table.grandTotalPaise} = ${table.itemsSubtotalPaise} + ${table.deliveryFeePaise} + ${table.smallBasketFeePaise} + ${table.packagingFeePaise}`,
    ),
    check(
      'order_amounts_not_negative',
      sql`${table.itemsSubtotalPaise} >= 0 and ${table.grandTotalPaise} >= 0 and ${table.taxTotalPaise} >= 0 and ${table.codCollectablePaise} >= 0`,
    ),
    check(
      'order_tax_within_total',
      sql`${table.taxTotalPaise} <= ${table.grandTotalPaise}`,
    ),
  ],
);

/**
 * One product on an order (spec §2.4.2).
 *
 * Carries its own status, which is what makes partial fulfilment, per-line
 * substitution and partial refunds possible at all (P4.1, P3.5).
 *
 * HSN and GST rate are snapshotted for the same reason as the price: the
 * invoice (P5.2) is issued against what was sold, and the catalog may be
 * corrected afterwards.
 */
export const orderLine = orderSchema.table(
  'order_line',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),

    /** Owned by catalog and offer. Snapshotted below, never joined at read. */
    masterProductId: uuid('master_product_id').notNull(),
    vendorOfferId: uuid('vendor_offer_id').notNull(),

    name: text('name').notNull(),
    slug: text('slug').notNull(),

    netQuantity: integer('net_quantity').notNull(),
    uom: text('uom').notNull(),
    isVariableWeight: boolean('is_variable_weight').notNull().default(false),

    hsnCode: text('hsn_code').notNull(),
    gstRateBp: integer('gst_rate_bp').notNull(),

    /** Packs for packaged goods, the product's own unit for loose goods. */
    quantity: integer('quantity').notNull(),

    unitPricePaise: integer('unit_price_paise').notNull(),
    mrpPaise: integer('mrp_paise').notNull(),
    lineTotalPaise: integer('line_total_paise').notNull(),
    lineMrpTotalPaise: integer('line_mrp_total_paise').notNull(),
    /** GST contained in `lineTotalPaise`. */
    taxPaise: integer('tax_paise').notNull().default(0),

    status: text('status').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('order_line_order_idx').on(table.orderId),
    index('order_line_product_idx').on(table.masterProductId),

    check('order_line_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'order_line_amounts_not_negative',
      sql`${table.unitPricePaise} >= 0 and ${table.lineTotalPaise} >= 0 and ${table.taxPaise} >= 0`,
    ),
    // Selling above MRP is unlawful (§3.7.3), and an order is where it would
    // actually be charged.
    check(
      'order_line_price_not_above_mrp',
      sql`${table.unitPricePaise} <= ${table.mrpPaise}`,
    ),
  ],
);

export type OrderRow = typeof order.$inferSelect;
export type OrderLineRow = typeof orderLine.$inferSelect;
