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
  /** A link to finish paying, after the first attempt failed (§2.10.3). */
  PAYMENT_LINK: 'PAYMENT_LINK',
  /** "Confirm this cash order", with yes/no buttons (§2.10.4, MEDIUM band). */
  COD_CONFIRM: 'COD_CONFIRM',
  /** A one-time code, for the band where a tapped button is not enough. */
  COD_OTP: 'COD_OTP',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_DISPATCHED_NOTICE: 'ORDER_DISPATCHED_NOTICE',
  ORDER_DELIVERED_NOTICE: 'ORDER_DELIVERED_NOTICE',
  ORDER_DELIVERY_FAILED_NOTICE: 'ORDER_DELIVERY_FAILED_NOTICE',
  ORDER_CANCELLED_NOTICE: 'ORDER_CANCELLED_NOTICE',
  /** Money is on its way back, and roughly when (§1.8.2). */
  REFUND_INITIATED: 'REFUND_INITIATED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
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

/**
 * What a customer can tap on a COD confirmation (§2.10.4).
 *
 * Separate from `VendorReply` on purpose. Both arrive on the same inbound
 * webhook, and a shared `CONFIRM`/`CANCEL` vocabulary would make "who tapped
 * this?" a question answered by guessing — a store tapping ACCEPT and a
 * customer tapping YES mean different things and move different transitions.
 */
export const CustomerReply = {
  /** Yes, I will take it and pay cash. */
  CONFIRM: 'CONFIRM',
  /** No — cancel it. Cheaper now than as an RTO. */
  DECLINE: 'DECLINE',
} as const;

export type CustomerReply = (typeof CustomerReply)[keyof typeof CustomerReply];

export const CUSTOMER_REPLIES = Object.values(CustomerReply);

export function isCustomerReply(value: string): value is CustomerReply {
  return (CUSTOMER_REPLIES as readonly string[]).includes(value);
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
  PAYMENT_LINK: NotificationUrgency.CRITICAL,
  // Both have a window measured in minutes, so quiet hours cannot apply: an
  // order held overnight for politeness is an order cancelled by its own timer.
  COD_CONFIRM: NotificationUrgency.CRITICAL,
  COD_OTP: NotificationUrgency.CRITICAL,
  ORDER_CONFIRMED: NotificationUrgency.CRITICAL,
  ORDER_DISPATCHED_NOTICE: NotificationUrgency.CRITICAL,
  ORDER_DELIVERED_NOTICE: NotificationUrgency.CRITICAL,
  ORDER_DELIVERY_FAILED_NOTICE: NotificationUrgency.CRITICAL,
  ORDER_CANCELLED_NOTICE: NotificationUrgency.CRITICAL,
  // Somebody is waiting on money they are owed. Holding this until morning to
  // be polite is exactly the wrong trade.
  REFUND_INITIATED: NotificationUrgency.CRITICAL,
  REFUND_COMPLETED: NotificationUrgency.CRITICAL,
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

// ---------------------------------------------------------------------------
// Telling the customer (§2.12, §4.2)
// ---------------------------------------------------------------------------

/**
 * Which customer template fires when an order reaches a state.
 *
 * A partial map on purpose: most states are the store's business, not the
 * customer's. Nobody wants a message saying their order moved from PICKING to
 * SUBSTITUTION_PENDING — they want to be told when something is *expected of
 * them*, or when the order visibly moves. A system that notifies on every
 * internal transition trains people to ignore it, which costs exactly the
 * message that mattered.
 */
export const CUSTOMER_TEMPLATE_FOR_STATUS: Partial<Record<string, NotificationTemplate>> =
  {
    ACCEPTED: NotificationTemplate.ORDER_CONFIRMED,

    /*
     * SUBSTITUTION_PENDING is deliberately absent (P4.1).
     *
     * P2.6 mapped it to SUBSTITUTION_PROPOSE because nothing else sent that
     * message yet. Now the §1.7.2 flow does — with the options the customer
     * has to choose between — and a generic status notice alongside it is both
     * a duplicate and a contradiction: §2.12 registers each template with the
     * provider against a fixed variable list, and one name cannot carry both
     * "here are three options" and "your order moved". In production exactly
     * one of the two would render.
     *
     * The map's own comment already said this: tell people when something is
     * expected of *them*, which is the flow's job and not a status change's.
     */
    PACKED: NotificationTemplate.ORDER_PACKED_CONFIRM,
    DISPATCHED: NotificationTemplate.ORDER_DISPATCHED_NOTICE,
    DELIVERED: NotificationTemplate.ORDER_DELIVERED_NOTICE,
    DELIVERY_FAILED: NotificationTemplate.ORDER_DELIVERY_FAILED_NOTICE,
    CANCELLED: NotificationTemplate.ORDER_CANCELLED_NOTICE,
  };

export function customerTemplateFor(status: string): NotificationTemplate | null {
  return CUSTOMER_TEMPLATE_FOR_STATUS[status] ?? null;
}
