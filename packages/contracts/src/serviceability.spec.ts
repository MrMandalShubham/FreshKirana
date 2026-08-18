import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUTOFF_MINUTES_BEFORE,
  SlotStatus,
  StoredSlotStatus,
  cutoffAt,
  effectiveSlotStatus,
  formatMinuteOfDay,
  isBookable,
  isPlausiblyInIndia,
  isValidLatitude,
  isValidLongitude,
  isValidPincode,
  istDateKey,
  istDayOfWeek,
  istInstant,
  slotCapacity,
  upcomingDateKeys,
} from './serviceability';

describe('coordinates', () => {
  it('accepts a real Bengaluru pin', () => {
    expect(isValidLatitude(12.9716)).toBe(true);
    expect(isValidLongitude(77.5946)).toBe(true);
    expect(isPlausiblyInIndia({ latitude: 12.9716, longitude: 77.5946 })).toBe(true);
  });

  it('catches latitude and longitude swapped', () => {
    // The classic bug: both values are individually valid, and (77.59, 12.97)
    // is in the Sea of Japan. Only the bounding box notices.
    const swapped = { latitude: 77.5946, longitude: 12.9716 };
    expect(isValidLatitude(swapped.latitude)).toBe(true);
    expect(isValidLongitude(swapped.longitude)).toBe(true);
    expect(isPlausiblyInIndia(swapped)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
  });

  it('covers the island territories', () => {
    // Port Blair and Kavaratti are in India, and a box drawn around the
    // mainland alone would refuse them.
    expect(isPlausiblyInIndia({ latitude: 11.6234, longitude: 92.7265 })).toBe(true);
    expect(isPlausiblyInIndia({ latitude: 10.5593, longitude: 72.6358 })).toBe(true);
  });

  it('validates pincodes', () => {
    expect(isValidPincode('560001')).toBe(true);
    expect(isValidPincode('060001')).toBe(false);
    expect(isValidPincode('56001')).toBe(false);
  });
});

describe('IST', () => {
  it('puts a late-evening UTC instant on the next Indian date', () => {
    // 19:00 UTC is 00:30 IST the following day. A slot booked then belongs to
    // tomorrow's service date, not today's.
    expect(istDateKey(new Date('2026-08-18T19:00:00Z'))).toBe('2026-08-19');
    expect(istDateKey(new Date('2026-08-18T18:29:00Z'))).toBe('2026-08-18');
  });

  it('converts a slot time back to an instant', () => {
    // 10:00 IST on 19 August is 04:30 UTC.
    expect(istInstant('2026-08-19', 600).toISOString()).toBe('2026-08-19T04:30:00.000Z');
  });

  it('round-trips a date through an instant', () => {
    const key = '2026-08-19';
    expect(istDateKey(istInstant(key, 600))).toBe(key);
    // Including the edges of the Indian day.
    expect(istDateKey(istInstant(key, 0))).toBe(key);
    expect(istDateKey(istInstant(key, 1439))).toBe(key);
  });

  it('reports the Indian day of week', () => {
    expect(istDayOfWeek('2026-08-19')).toBe(3); // a Wednesday
  });

  it('lists upcoming service dates', () => {
    expect(upcomingDateKeys(new Date('2026-08-18T06:00:00Z'), 3)).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ]);
  });

  it('formats a minute of day', () => {
    expect(formatMinuteOfDay(600)).toBe('10:00');
    expect(formatMinuteOfDay(870)).toBe('14:30');
    expect(formatMinuteOfDay(0)).toBe('00:00');
  });
});

describe('slot capacity', () => {
  it('takes the smaller of picking and delivery', () => {
    // Eight orders you can pack and two riders to deliver them is a capacity
    // of two, not eight.
    expect(slotCapacity({ pickingCapacityOrders: 8, deliveryCapacityOrders: 2 })).toBe(2);
    expect(slotCapacity({ pickingCapacityOrders: 2, deliveryCapacityOrders: 8 })).toBe(2);
  });

  it('never goes negative', () => {
    expect(slotCapacity({ pickingCapacityOrders: -5, deliveryCapacityOrders: 3 })).toBe(
      0,
    );
  });
});

describe('slot status', () => {
  const startsAt = new Date('2026-08-19T04:30:00Z'); // 10:00 IST
  const base = {
    startsAt,
    cutoffMinutesBefore: DEFAULT_CUTOFF_MINUTES_BEFORE,
    capacity: 5,
    booked: 0,
    storedStatus: StoredSlotStatus.OPEN,
  };

  const wellBefore = new Date('2026-08-19T01:00:00Z');

  it('is open with room and time to spare', () => {
    expect(effectiveSlotStatus(base, wellBefore)).toBe(SlotStatus.OPEN);
    expect(isBookable(base, wellBefore)).toBe(true);
  });

  it('is full once capacity is reached', () => {
    const full = { ...base, booked: 5 };
    expect(effectiveSlotStatus(full, wellBefore)).toBe(SlotStatus.FULL);
    expect(isBookable(full, wellBefore)).toBe(false);
  });

  it('closes at the cutoff, not at the start', () => {
    // 90 minutes before 10:00 IST is 08:30 IST — 03:00 UTC.
    expect(cutoffAt(startsAt, 90).toISOString()).toBe('2026-08-19T03:00:00.000Z');

    const oneMinuteBeforeCutoff = new Date('2026-08-19T02:59:00Z');
    const atCutoff = new Date('2026-08-19T03:00:00Z');

    expect(effectiveSlotStatus(base, oneMinuteBeforeCutoff)).toBe(SlotStatus.OPEN);
    expect(effectiveSlotStatus(base, atCutoff)).toBe(SlotStatus.CLOSED);
  });

  it('reports a blackout even when the slot has room', () => {
    const blackout = { ...base, storedStatus: StoredSlotStatus.BLACKOUT };
    expect(effectiveSlotStatus(blackout, wellBefore)).toBe(SlotStatus.BLACKOUT);
  });

  it('prefers the vendor-declared blackout over a full slot', () => {
    // The shopper should be told the store is shut, not that they were too
    // slow — the two suggest different things about coming back.
    const both = { ...base, booked: 5, storedStatus: StoredSlotStatus.BLACKOUT };
    expect(effectiveSlotStatus(both, wellBefore)).toBe(SlotStatus.BLACKOUT);
  });

  it('treats a zero-capacity slot as full rather than open', () => {
    const none = { ...base, capacity: 0, booked: 0 };
    expect(effectiveSlotStatus(none, wellBefore)).toBe(SlotStatus.FULL);
  });
});
