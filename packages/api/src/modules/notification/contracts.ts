/**
 * Public interface of the notification module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * This module sends and records; it never decides. Whoever calls it owns the
 * decision about *what* to say and *when* — which is why nothing here mentions
 * an order.
 */

export { NotificationService } from './internal/notification.service';
export type { SendInput } from './internal/notification.service';

export { WhatsAppChannel, WHATSAPP_CHANNEL } from './internal/whatsapp.channel';
export type {
  InboundReply,
  OutboundMessage,
  SendResult,
} from './internal/whatsapp.channel';

export type { MessageRow, InboundMessageRow } from './schema';

export {
  MessageStatus,
  NotificationChannel,
  NotificationTemplate,
  NotificationUrgency,
  TEMPLATE_URGENCY,
  VendorReply,
  isVendorReply,
} from '@freshkirana/contracts';
