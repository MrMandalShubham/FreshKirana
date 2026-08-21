import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
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

    /**
     * What the scale said, in grams (spec §1.7.1).
     *
     * Null until somebody weighs it, and null forever on a packaged line — a
     * sealed 1 kg bag of atta is not weighed and pretending otherwise would put
     * a fiction in the invoice.
     *
     * Integer grams for the same reason money is integer paise: a scale reads
     * 0.94 kg and a float stores 0.9400000000000001. Grams are exact, and 1 g is
     * finer than any shop scale in India resolves.
     */
    actualGrams: integer('actual_grams'),

    /**
     * Price per kilogram at the moment of weighing, in paise.
     *
     * Snapshotted onto the line rather than read back from the offer, because
     * the offer's price can change between the order and the scale — and the
     * customer agreed to the price they were shown, not the one in force when a
     * picker happened to reach that shelf.
     */
    pricePerKgPaise: integer('price_per_kg_paise'),

    /** The band this line was sold under. Snapshotted for the same reason. */
    weightTolerancePct: integer('weight_tolerance_pct'),

    weighedAt: timestamp('weighed_at', { withTimezone: true }),

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

/**
 * Every status change an order has ever made (spec §2.6, §3.8).
 *
 * The order table holds where an order *is*; this holds how it got there. That
 * matters twice over: §3.8 requires an audit trail for anything ops can touch,
 * and every fulfilment argument — "the store says they accepted at 6, the
 * customer says it was never confirmed" — is settled by this table or by
 * nobody.
 *
 * Append-only by intent. Nothing in the codebase updates or deletes a row here.
 */
export const orderStatusHistory = orderSchema.table(
  'order_status_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),

    /** Null on the row recording placement — there was no previous state. */
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),

    /** Who did it. Null when the system moved it on its own. */
    actorAccountId: uuid('actor_account_id'),
    actorRole: text('actor_role'),

    /** Required by the guard on rejections, cancellations and failed delivery. */
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('order_status_history_order_idx').on(table.orderId, table.createdAt),
    check(
      'order_status_history_moved',
      sql`${table.fromStatus} is distinct from ${table.toStatus}`,
    ),
  ],
);

/**
 * One line that could not be filled, and what was done about it (spec §1.7.2).
 *
 * A row per *proposal*, not per line: a picker who offers a substitute the
 * customer rejects may offer another, and an order that lost two items has two
 * of these. Collapsing it onto the line would lose the history that answers
 * "why did I get this?" — which is the only question anybody asks about a
 * substitution.
 *
 * The options are snapshotted as JSON rather than referenced. They are what the
 * customer was actually shown, and an offer that changes price or sells out an
 * hour later must not rewrite what they were asked.
 */
export const substitution = orderSchema.table(
  'substitution',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLine.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),

    /** The preference in force when this was raised (§1.7.2). */
    preference: text('preference').notNull(),
    status: text('status').notNull(),

    /** What the customer was shown, exactly as they saw it. */
    options: jsonb('options').notNull().default([]),

    /** The offer chosen, by whoever chose it. Null until something is. */
    chosenVendorOfferId: uuid('chosen_vendor_offer_id'),
    chosenName: text('chosen_name'),

    /** What the line cost before, and what it costs now. */
    originalLineTotalPaise: integer('original_line_total_paise').notNull(),
    chargedLineTotalPaise: integer('charged_line_total_paise'),
    refundPaise: integer('refund_paise').notNull().default(0),

    /**
     * Whether the customer agreed to pay more (§1.7.2).
     *
     * Recorded rather than inferred: "never charge more without explicit
     * consent" is only enforceable if the consent is a fact somebody can point
     * at afterwards.
     */
    consentedToHigherPrice: boolean('consented_to_higher_price').notNull().default(false),

    /** After this, §1.7.2's fallback applies and the line is refunded. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('substitution_order_idx').on(table.orderId),
    // One open proposal per line. Two live questions about the same item is how
    // a customer answers one and gets the other.
    uniqueIndex('substitution_open_line_key')
      .on(table.orderLineId)
      .where(sql`status = 'PROPOSED'`),
    // The sweep that applies the timeout fallback.
    index('substitution_pending_idx').on(table.status, table.expiresAt),
  ],
);

export type OrderRow = typeof order.$inferSelect;
export type SubstitutionRow = typeof substitution.$inferSelect;
export type OrderLineRow = typeof orderLine.$inferSelect;
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect;
