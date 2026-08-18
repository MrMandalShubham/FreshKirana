import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MessageStatus,
  NotificationChannel,
  type NotificationTemplate,
  type VendorReply,
} from '@freshkirana/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { inboundMessage, message } from '../schema';
import {
  type InboundReply,
  WHATSAPP_CHANNEL,
  type WhatsAppChannel,
} from './whatsapp.channel';

export interface SendInput {
  toPhone: string;
  template: NotificationTemplate;
  payload?: Record<string, unknown>;
  quickReplies?: readonly VendorReply[];
  accountId?: string | null;
  vendorId?: string | null;
  orderId?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WHATSAPP_CHANNEL) private readonly whatsapp: WhatsAppChannel,
  ) {}

  /**
   * Sends a WhatsApp message and records what happened.
   *
   * The row is written **before** the send, so a message that fails mid-flight
   * still leaves evidence. A log written only on success answers "what did we
   * send?" and never "what did we try to send?", which is the question asked
   * during an incident.
   *
   * Never throws. A notification that fails must not roll back the order it was
   * about — the store not hearing about an order is bad, an order that does not
   * exist because the store could not be told is worse.
   */
  async send(input: SendInput) {
    const queued = await this.db
      .insert(message)
      .values({
        channel: NotificationChannel.WHATSAPP,
        template: input.template,
        toPhone: input.toPhone,
        payload: input.payload ?? {},
        accountId: input.accountId ?? null,
        vendorId: input.vendorId ?? null,
        orderId: input.orderId ?? null,
        status: MessageStatus.QUEUED,
      })
      .returning();

    const row = queued[0]!;

    try {
      const result = await this.whatsapp.send({
        toPhone: input.toPhone,
        template: input.template,
        payload: input.payload ?? {},
        quickReplies: input.quickReplies,
      });

      const updated = await this.db
        .update(message)
        .set({
          status: result.accepted ? MessageStatus.SENT : MessageStatus.FAILED,
          providerMessageId: result.providerMessageId,
          failureReason: result.failureReason ?? null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(message.id, row.id))
        .returning();

      return updated[0]!;
    } catch (error) {
      this.logger.error(
        `Failed to send ${input.template} to ${input.toPhone}: ${String(error)}`,
      );

      const failed = await this.db
        .update(message)
        .set({
          status: MessageStatus.FAILED,
          failureReason: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(message.id, row.id))
        .returning();

      return failed[0]!;
    }
  }

  /** Was this template already sent for this order? Backs the SLA sweeper. */
  async wasSentForOrder(
    orderId: string,
    template: NotificationTemplate,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: message.id })
      .from(message)
      .where(and(eq(message.orderId, orderId), eq(message.template, template)))
      .limit(1);

    return rows.length > 0;
  }

  /** The messages sent about an order. The dev outbox, and the audit trail. */
  async messagesForOrder(orderId: string) {
    return this.db
      .select()
      .from(message)
      .where(eq(message.orderId, orderId))
      .orderBy(desc(message.createdAt));
  }

  /** Recent messages to a store, newest first. */
  async messagesForVendor(vendorId: string, limit = 20) {
    return this.db
      .select()
      .from(message)
      .where(eq(message.vendorId, vendorId))
      .orderBy(desc(message.createdAt))
      .limit(Math.min(limit, 100));
  }

  parseInbound(body: unknown): InboundReply | null {
    return this.whatsapp.parseInbound(body);
  }

  /**
   * Records an inbound reply, or reports that it has been seen before.
   *
   * The unique key on (channel, provider message id) is what makes the webhook
   * idempotent. Providers retry — that is documented behaviour, not an edge
   * case — and an "accept" applied twice is harmless right up until the button
   * is "cancel".
   */
  async recordInbound(
    reply: InboundReply,
    context: { orderId?: string | null; inReplyToMessageId?: string | null } = {},
  ): Promise<{ isNew: boolean; id: string }> {
    const inserted = await this.db
      .insert(inboundMessage)
      .values({
        channel: NotificationChannel.WHATSAPP,
        providerMessageId: reply.providerMessageId,
        fromPhone: reply.fromPhone,
        reply: reply.reply,
        raw: reply.raw,
        orderId: context.orderId ?? null,
        inReplyToMessageId: context.inReplyToMessageId ?? null,
      })
      .onConflictDoNothing({
        target: [inboundMessage.channel, inboundMessage.providerMessageId],
      })
      .returning({ id: inboundMessage.id });

    const row = inserted[0];
    if (row) return { isNew: true, id: row.id };

    const existing = await this.db
      .select({ id: inboundMessage.id })
      .from(inboundMessage)
      .where(
        and(
          eq(inboundMessage.channel, NotificationChannel.WHATSAPP),
          eq(inboundMessage.providerMessageId, reply.providerMessageId),
        ),
      )
      .limit(1);

    return { isNew: false, id: existing[0]!.id };
  }

  /** Notes what the reply caused, so the log explains itself later. */
  async recordOutcome(inboundId: string, outcome: string): Promise<void> {
    await this.db
      .update(inboundMessage)
      .set({ outcome })
      .where(eq(inboundMessage.id, inboundId));
  }

  /** Finds the message a reply is answering, so we know which order it means. */
  async findByProviderMessageId(providerMessageId: string) {
    const rows = await this.db
      .select()
      .from(message)
      .where(eq(message.providerMessageId, providerMessageId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * The most recent message to this number that expects a reply.
   *
   * WhatsApp does not always tell you what a tap was replying to, and a store
   * with two open orders would otherwise have its answer applied to the wrong
   * one. Falling back to "the last thing we asked them" is what a human would
   * assume, which makes it the least surprising rule available.
   */
  async lastAwaitingReply(fromPhone: string, template: NotificationTemplate) {
    const rows = await this.db
      .select()
      .from(message)
      .where(and(eq(message.toPhone, fromPhone), eq(message.template, template)))
      .orderBy(desc(message.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }
}
