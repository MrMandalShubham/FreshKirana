/**
 * Serviceability and slot vocabulary (spec §2.8).
 *
 * Two questions live here: *can we deliver to this address at all*, and *when*.
 * Both are answered before a shopper is allowed to spend time filling a basket,
 * because discovering "we don't deliver here" at checkout wastes the only thing
 * a first-time customer has given us — their attention.
 */

export const AddressLabel = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;

export type AddressLabel = (typeof AddressLabel)[keyof typeof AddressLabel];

/**
 * How a store's service area is described (§2.8.1).
 *
 * A polygon is preferred: real delivery boundaries follow roads, rivers and
 * railway lines, not circles. The radius fallback exists because a new vendor
 * can give you a pin and "about 3 km" in thirty seconds, and waiting for a
 * drawn polygon would keep them off the platform.
 */
export const ServiceAreaMode = {
  POLYGON: 'POLYGON',
  RADIUS: 'RADIUS',
} as const;

export type ServiceAreaMode = (typeof ServiceAreaMode)[keyof typeof ServiceAreaMode];

/**
 * What a shopper sees against a slot.
 *
 * `OPEN`, `CLOSED` and `BLACKOUT` are stored — they are somebody's decision.
 * `FULL` is **derived** from booked against capacity: storing it would mean two
 * sources of truth for one fact, and every release path would have to remember
 * to undo it.
 */
export const SlotStatus = {
  OPEN: 'OPEN',
  FULL: 'FULL',
  /** Past its cutoff, or closed by ops (§2.8.2 over-commit protection). */
  CLOSED: 'CLOSED',
  /** Vendor holiday, festival, declared closure. */
  BLACKOUT: 'BLACKOUT',
} as const;

export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus];

/** Stored intent. Everything else about a slot is computed. */
export const StoredSlotStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  BLACKOUT: 'BLACKOUT',
} as const;

export type StoredSlotStatus = (typeof StoredSlotStatus)[keyof typeof StoredSlotStatus];

/** Default cutoff: a slot closes 90 minutes before it starts (§2.8.2). */
export const DEFAULT_CUTOFF_MINUTES_BEFORE = 90;

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * A generous bounding box around India, including the island territories.
 *
 * This is not a serviceability check — it catches the single most common
 * coordinate bug instead. Latitude and longitude swapped is silently valid
 * almost everywhere on earth, and for Bengaluru (12.97, 77.59) the swap lands
 * in the Sea of Japan. Caught here it is a 400; missed, it is a store that
 * appears to serve nobody and an address nobody can explain.
 */
export function isPlausiblyInIndia(point: LatLng): boolean {
  return (
    point.latitude >= 6 &&
    point.latitude <= 38 &&
    point.longitude >= 68 &&
    point.longitude <= 98
  );
}

/** Indian pincode: six digits, never starting with zero. */
export function isValidPincode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * India Standard Time, as a fixed offset from UTC.
 *
 * India observes no daylight saving and has a single time zone, so a fixed
 * offset is *correct* here rather than a shortcut that breaks in March. If the
 * product ever serves a country with DST, this is the thing to replace — which
 * is why every conversion goes through these two functions.
 */
export const IST_OFFSET_MINUTES = 330;

const MS_PER_MINUTE = 60_000;

/** The service date (`YYYY-MM-DD`) an instant falls on, in IST. */
export function istDateKey(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10);
}

/** The instant at `minuteOfDay` IST on a service date. */
export function istInstant(dateKey: string, minuteOfDay: number): Date {
  const midnightUtc = Date.parse(`${dateKey}T00:00:00.000Z`);
  return new Date(midnightUtc + (minuteOfDay - IST_OFFSET_MINUTES) * MS_PER_MINUTE);
}

/** Day of week in IST, 0 = Sunday, matching `slot_definition.day_of_week`. */
export function istDayOfWeek(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

/** The next `count` service dates in IST, starting with today. */
export function upcomingDateKeys(from: Date, count: number): string[] {
  const keys: string[] = [];
  for (let day = 0; day < count; day += 1) {
    keys.push(istDateKey(new Date(from.getTime() + day * 24 * 60 * MS_PER_MINUTE)));
  }
  return keys;
}

/** `14:30` for minute 870. For display, and for slot labels. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60) % 24;
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Slot capacity is the **minimum of picking and delivery capacity** (§2.8.2).
 *
 * Modelling only one of them is how a store ends up with eight orders it can
 * pack and two riders to deliver them. Both constrain, so the smaller wins.
 */
export function slotCapacity(input: {
  pickingCapacityOrders: number;
  deliveryCapacityOrders: number;
}): number {
  return Math.max(0, Math.min(input.pickingCapacityOrders, input.deliveryCapacityOrders));
}

/** The moment a slot stops accepting orders. */
export function cutoffAt(startsAt: Date, cutoffMinutesBefore: number): Date {
  return new Date(startsAt.getTime() - cutoffMinutesBefore * MS_PER_MINUTE);
}

export interface SlotState {
  startsAt: Date;
  cutoffMinutesBefore: number;
  capacity: number;
  booked: number;
  storedStatus: StoredSlotStatus;
}

/**
 * What the shopper is shown for this slot.
 *
 * §2.8.2 requires full slots to be visible and greyed rather than hidden: a
 * disappearing slot reads as a bug, while a greyed one with the next available
 * highlighted reads as information.
 */
export function effectiveSlotStatus(state: SlotState, now: Date): SlotStatus {
  if (state.storedStatus === StoredSlotStatus.BLACKOUT) return SlotStatus.BLACKOUT;
  if (state.storedStatus === StoredSlotStatus.CLOSED) return SlotStatus.CLOSED;
  if (now >= cutoffAt(state.startsAt, state.cutoffMinutesBefore))
    return SlotStatus.CLOSED;
  if (state.booked >= state.capacity) return SlotStatus.FULL;
  return SlotStatus.OPEN;
}

export function isBookable(state: SlotState, now: Date): boolean {
  return effectiveSlotStatus(state, now) === SlotStatus.OPEN;
}
