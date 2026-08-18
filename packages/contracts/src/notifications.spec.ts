import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PRIORITY,
  DEFAULT_ACCEPTANCE_SLA,
  NOTIFICATION_TEMPLATES,
  NotificationChannel,
  NotificationTemplate,
  NotificationUrgency,
  TEMPLATE_URGENCY,
  hasBreached,
  isVendorReply,
  minutesSince,
  needsReminder,
} from './notifications';

describe('the template catalogue', () => {
  it('declares an urgency for every template', () => {
    // A template with no urgency is a template the quiet-hours rule cannot
    // classify, and the safe default — hold it — would silently delay an order.
    for (const template of NOTIFICATION_TEMPLATES) {
      expect(TEMPLATE_URGENCY[template], `no urgency for ${template}`).toBeTruthy();
    }
  });

  it('never holds an order message overnight', () => {
    // A store must hear about an order at 21:30. Only digests and statements
    // wait for morning.
    expect(TEMPLATE_URGENCY[NotificationTemplate.ORDER_NEW]).toBe(
      NotificationUrgency.CRITICAL,
    );
    expect(TEMPLATE_URGENCY[NotificationTemplate.LOW_STOCK_DIGEST]).toBe(
      NotificationUrgency.ROUTINE,
    );
  });

  it('has the §1.9.3 launch templates', () => {
    for (const required of [
      'ORDER_NEW',
      'ORDER_REMINDER',
      'ITEM_OOS_PROMPT',
      'SUBSTITUTION_PROPOSE',
      'ORDER_PACKED_CONFIRM',
      'HANDOVER_CONFIRM',
      'PAYOUT_STATEMENT',
      'LOW_STOCK_DIGEST',
    ]) {
      expect(NOTIFICATION_TEMPLATES).toContain(required);
    }
  });

  it('tries WhatsApp before anything that costs money', () => {
    expect(CHANNEL_PRIORITY[0]).toBe(NotificationChannel.WHATSAPP);
    expect(CHANNEL_PRIORITY.indexOf(NotificationChannel.SMS)).toBeGreaterThan(
      CHANNEL_PRIORITY.indexOf(NotificationChannel.PUSH),
    );
  });
});

describe('quick replies', () => {
  it('recognises the buttons a store can tap', () => {
    expect(isVendorReply('ACCEPT')).toBe(true);
    expect(isVendorReply('REJECT')).toBe(true);
  });

  it('rejects anything a human typed', () => {
    // Free text is somebody trying to talk to us. That is a support
    // conversation, not an order transition.
    expect(isVendorReply('accept please')).toBe(false);
    expect(isVendorReply('haan bhej do')).toBe(false);
    expect(isVendorReply('')).toBe(false);
  });
});

describe('the acceptance SLA (§1.9.4)', () => {
  const placedAt = new Date('2026-08-18T10:00:00Z');
  const at = (minutes: number) => new Date(placedAt.getTime() + minutes * 60_000);

  it('measures elapsed minutes', () => {
    expect(minutesSince(placedAt, at(7))).toBe(7);
  });

  it('says nothing in the first five minutes', () => {
    expect(needsReminder(placedAt, DEFAULT_ACCEPTANCE_SLA, at(4))).toBe(false);
    expect(hasBreached(placedAt, DEFAULT_ACCEPTANCE_SLA, at(4))).toBe(false);
  });

  it('reminds at five', () => {
    expect(needsReminder(placedAt, DEFAULT_ACCEPTANCE_SLA, at(5))).toBe(true);
    expect(needsReminder(placedAt, DEFAULT_ACCEPTANCE_SLA, at(9))).toBe(true);
    expect(hasBreached(placedAt, DEFAULT_ACCEPTANCE_SLA, at(9))).toBe(false);
  });

  it('gives up at ten', () => {
    expect(hasBreached(placedAt, DEFAULT_ACCEPTANCE_SLA, at(10))).toBe(true);
    // And stops asking for a reminder, so a breached order is not nagged.
    expect(needsReminder(placedAt, DEFAULT_ACCEPTANCE_SLA, at(10))).toBe(false);
  });

  it('honours a tightened peak-hour window', () => {
    // §1.9.4 halves the window in peak. These are configuration, not constants.
    const peak = { reminderAfterMinutes: 2, breachAfterMinutes: 5 };
    expect(needsReminder(placedAt, peak, at(3))).toBe(true);
    expect(hasBreached(placedAt, peak, at(6))).toBe(true);
  });
});
