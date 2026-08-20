/**
 * Analytics event catalogue (spec §5.1).
 *
 * **This file is standing rule R1.** Untracked launch weeks cannot be
 * recovered: any future funnel analysis, §1.11 rollout gate, or §2.17 model
 * trains on data that was either captured at the time or was not. There is no
 * backfill.
 *
 * Events are declared here as a closed union rather than passed as free strings,
 * so emitting an undeclared event is a compile error and the catalogue cannot
 * drift from what the code actually sends.
 */

export const AnalyticsEvent = {
  // Discovery
  APP_OPENED: 'app_opened',
  /**
   * A visitor asked whether we deliver to a pin (§2.8.1). Named in the §5.2
   * acquisition funnel, and the denominator for the one below — a waitlist
   * count means nothing without the number of people who asked.
   */
  SERVICEABILITY_CHECKED: 'serviceability_checked',
  /** Demand where there is no supply yet — the primary §1.11 expansion input. */
  WAITLIST_JOINED: 'waitlist_joined',
  SEARCH_PERFORMED: 'search_performed',
  SEARCH_RESULT_CLICKED: 'search_result_clicked',
  CATEGORY_VIEWED: 'category_viewed',
  PRODUCT_VIEWED: 'product_viewed',

  // Basket
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  CART_VIEWED: 'cart_viewed',
  USUAL_BASKET_SHOWN: 'usual_basket_shown',
  USUAL_BASKET_ACCEPTED: 'usual_basket_accepted',

  // Checkout
  CHECKOUT_STARTED: 'checkout_started',
  ADDRESS_SELECTED: 'address_selected',
  SLOT_SELECTED: 'slot_selected',
  SUBSTITUTION_PREFERENCE_SET: 'substitution_preference_set',
  PAYMENT_METHOD_SELECTED: 'payment_method_selected',
  PAYMENT_INITIATED: 'payment_initiated',
  PAYMENT_FAILED: 'payment_failed',
  /**
   * A second attempt was offered after a failure (§2.10.3).
   *
   * The denominator for whether recovery works at all: UPI failure is common
   * and directly costs revenue, and without this the only visible number is
   * how many orders were lost.
   */
  PAYMENT_RETRIED: 'payment_retried',
  /** The recovery link was sent. */
  PAYMENT_LINK_SENT: 'payment_link_sent',
  /** The shopper took cash on delivery rather than abandoning the order. */
  PAYMENT_CONVERTED_TO_COD: 'payment_converted_to_cod',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  ORDER_PLACED: 'order_placed',
  RESERVATION_FAILED: 'reservation_failed',

  // Fulfilment
  VENDOR_ACCEPTED: 'vendor_accepted',
  LINE_MARKED_OOS: 'line_marked_oos',
  SUBSTITUTION_PROPOSED: 'substitution_proposed',
  SUBSTITUTION_ACCEPTED: 'substitution_accepted',
  SUBSTITUTION_REJECTED: 'substitution_rejected',
  WEIGHT_RECORDED: 'weight_recorded',
  ORDER_PACKED: 'order_packed',
  ORDER_DISPATCHED: 'order_dispatched',
  ORDER_DELIVERED: 'order_delivered',
  DELIVERY_FAILED: 'delivery_failed',

  // Money
  COD_COLLECTED: 'cod_collected',
  COD_DEPOSITED: 'cod_deposited',
  COD_SHORTFALL_RAISED: 'cod_shortfall_raised',

  // Post-order
  ORDER_CANCELLED: 'order_cancelled',
  REFUND_INITIATED: 'refund_initiated',
  REFUND_COMPLETED: 'refund_completed',
  REORDER_CLICKED: 'reorder_clicked',
  RATING_SUBMITTED: 'rating_submitted',
  SUPPORT_TICKET_CREATED: 'support_ticket_created',
} as const;

export type AnalyticsEvent = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export const ANALYTICS_EVENTS = Object.values(AnalyticsEvent);

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

export const Platform = {
  WEB: 'web',
  ANDROID: 'android',
  IOS: 'ios',
  SERVER: 'server',
  WHATSAPP: 'whatsapp',
} as const;

export type Platform = (typeof Platform)[keyof typeof Platform];

/**
 * Properties carried on every event (spec §5.1).
 *
 * Identity is by id only. Resolving an id to a person happens in the warehouse,
 * behind access controls — never in the event stream (§5.3).
 */
export interface AnalyticsEnvelope {
  eventId: string;
  event: AnalyticsEvent;
  occurredAt: string;
  /** Null for anonymous sessions; `anonId` still ties the funnel together. */
  accountId: string | null;
  anonId: string;
  sessionId: string;
  platform: Platform;
  appVersion: string | null;
  city: string | null;
  experimentVariants: Record<string, string>;
  properties: Record<string, unknown>;
}

/**
 * Property keys that must never appear in the event stream (spec §5.3).
 *
 * Analytics data is copied to a warehouse, queried broadly, and retained far
 * longer than transactional data. Personal data landing here escapes the
 * retention and access controls of §3.6, so it is rejected at ingest rather
 * than filtered later.
 */
export const FORBIDDEN_PROPERTY_KEYS = [
  'phone',
  'phonenumber',
  'mobile',
  'email',
  'name',
  'displayname',
  'fullname',
  'address',
  'addressline',
  'pincode',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'otp',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'card',
  'cardnumber',
  'cvv',
  'upi',
  'vpa',
  'pan',
  'aadhaar',
  'gstin',
  'bankaccount',
  'ifsc',
] as const;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns the offending property paths, or an empty array if clean.
 * Nested objects are walked — PII hides in `{ user: { phone } }`.
 */
export function findForbiddenProperties(
  properties: Record<string, unknown>,
  path: string[] = [],
): string[] {
  const found: string[] = [];

  for (const [key, value] of Object.entries(properties)) {
    const here = [...path, key];

    if ((FORBIDDEN_PROPERTY_KEYS as readonly string[]).includes(normaliseKey(key))) {
      found.push(here.join('.'));
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      found.push(...findForbiddenProperties(value as Record<string, unknown>, here));
    }
  }

  return found;
}
