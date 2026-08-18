/**
 * Notification vocabulary (spec §2.12, §1.9.3).
 *
 * The vendor's interface is WhatsApp, not a dashboard (§0.3). A kirana owner
 * will not learn a new app, and a system that requires them to is a system with
 * no vendors — so these templates are not a convenience layer over the real
 * product, they *are* the vendor product.
 */

export const NotificationChannel = {
  WHATSAPP: 'WHATSAPP',
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
} as const;

export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

/**
 * Channel priority (§2.12). WhatsApp first, everything else is fallback.
 *
 * SMS sits below push deliberately: it costs money per message and requires
 * TRAI DLT registration per template, so it is what you reach for when the
 * free channels have failed, not first.
 */
export const CHANNEL_PRIORITY: readonly NotificationChannel[] = [
  NotificationChannel.WHATSAPP,
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
];

/**
 * The template catalogue (§1.9.3).
 *
 * A closed union for the same reason as the analytics catalogue (rule R1):
 * WhatsApp templates must be **pre-approved by the BSP before they can be
 * sent**, with one to two weeks of lead time. A template invented in code at
 * runtime is a message that will silently fail in production. Adding one here
 * is a deliberate act that should be accompanied by a submission.
 */
export const NotificationTemplate = {
  // --- Vendor (§1.9.3) ---
  /** A new order, with accept and reject buttons. */
  ORDER_NEW: 'ORDER_NEW',
  /** The acceptance SLA is running out (§1.9.4). */
  ORDER_REMINDER: 'ORDER_REMINDER',
  ITEM_OOS_PROMPT: 'ITEM_OOS_PROMPT',
  SUBSTITUTION_PROPOSE: 'SUBSTITUTION_PROPOSE',
  ORDER_PACKED_CONFIRM: 'ORDER_PACKED_CONFIRM',
  HANDOVER_CONFIRM: 'HANDOVER_CONFIRM',
  PAYOUT_STATEMENT: 'PAYOUT_STATEMENT',
  LOW_STOCK_DIGEST: 'LOW_STOCK_DIGEST',

  // --- Customer ---
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_CANCELLED_NOTICE: 'ORDER_CANCELLED_NOTICE',
} as const;

export type NotificationTemplate =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

export const NOTIFICATION_TEMPLATES = Object.values(NotificationTemplate);

/**
 * Templates a store can reply to, and what the buttons mean.
 *
 * Quick replies are the whole point: a vendor taps a button, they do not type.
 * Any inbound text that is not one of these is a human trying to talk to us,
 * and belongs in support rather than in an order transition.
 */
export const VendorReply = {
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
  PACKED: 'PACKED',
  HANDED_OVER: 'HANDED_OVER',
} as const;

export type VendorReply = (typeof VendorReply)[keyof typeof VendorReply];

export const VENDOR_REPLIES = Object.values(VendorReply);

export function isVendorReply(value: string): value is VendorReply {
  return (VENDOR_REPLIES as readonly string[]).includes(value);
}

/** Whether a message may be held until quiet hours end (§2.12). */
export const NotificationUrgency = {
  /** Order-critical. Sent whatever the hour. */
  CRITICAL: 'CRITICAL',
  /** Digests, statements, marketing. Held overnight. */
  ROUTINE: 'ROUTINE',
} as const;

export type NotificationUrgency =
  (typeof NotificationUrgency)[keyof typeof NotificationUrgency];

export const TEMPLATE_URGENCY: Record<NotificationTemplate, NotificationUrgency> = {
  ORDER_NEW: NotificationUrgency.CRITICAL,
  ORDER_REMINDER: NotificationUrgency.CRITICAL,
  ITEM_OOS_PROMPT: NotificationUrgency.CRITICAL,
  SUBSTITUTION_PROPOSE: NotificationUrgency.CRITICAL,
  ORDER_PACKED_CONFIRM: NotificationUrgency.CRITICAL,
  HANDOVER_CONFIRM: NotificationUrgency.CRITICAL,
  ORDER_CONFIRMED: NotificationUrgency.CRITICAL,
  ORDER_CANCELLED_NOTICE: NotificationUrgency.CRITICAL,
  PAYOUT_STATEMENT: NotificationUrgency.ROUTINE,
  LOW_STOCK_DIGEST: NotificationUrgency.ROUTINE,
};

/** Delivery state of one message, for the §2.12 dispute-evidence log. */
export const MessageStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;

export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

// ---------------------------------------------------------------------------
// Vendor SLAs (§1.9.4)
// ---------------------------------------------------------------------------

/**
 * Acceptance SLA. Configuration, not constants — §1.9.4 has a tighter window in
 * peak hours, and a pilot city will want to tune these before a release cycle
 * allows.
 */
export interface AcceptanceSla {
  /** Remind the store this many minutes after the order arrives. */
  reminderAfterMinutes: number;
  /** Give up this many minutes after the order arrives. */
  breachAfterMinutes: number;
}

export const DEFAULT_ACCEPTANCE_SLA: AcceptanceSla = {
  reminderAfterMinutes: 5,
  breachAfterMinutes: 10,
};

export function minutesSince(instant: Date, now: Date): number {
  return (now.getTime() - instant.getTime()) / 60_000;
}

export function needsReminder(placedAt: Date, sla: AcceptanceSla, now: Date): boolean {
  const elapsed = minutesSince(placedAt, now);
  return elapsed >= sla.reminderAfterMinutes && elapsed < sla.breachAfterMinutes;
}

export function hasBreached(placedAt: Date, sla: AcceptanceSla, now: Date): boolean {
  return minutesSince(placedAt, now) >= sla.breachAfterMinutes;
}
