import { Injectable, Logger } from '@nestjs/common';
import {
  type CustomerReply,
  NotificationChannel,
  type NotificationTemplate,
  isCustomerReply,
  isVendorReply,
  type VendorReply,
} from '@freshkirana/contracts';
import { randomUUID } from 'node:crypto';

export interface OutboundMessage {
  toPhone: string;
  template: NotificationTemplate;
  payload: Record<string, unknown>;
  /** Buttons the recipient can tap. Empty for a message with no reply. */
  quickReplies?: readonly (VendorReply | CustomerReply)[];
}

export interface SendResult {
  providerMessageId: string;
  /** False when the provider refused it. The caller records why. */
  accepted: boolean;
  failureReason?: string;
}

export interface InboundReply {
  providerMessageId: string;
  fromPhone: string;
  /**
   * Null when the sender typed rather than tapped.
   *
   * Either vocabulary: stores and customers both tap buttons, and they arrive
   * on the same webhook. Which one this is determines what happens next, so the
   * raw token is carried through rather than narrowed here.
   */
  reply: VendorReply | CustomerReply | null;
  /** Our own message id, when the provider echoes what was replied to. */
  inReplyToProviderMessageId?: string;
  raw: Record<string, unknown>;
}

/**
 * A messaging provider (spec §2.12).
 *
 * The interface exists so the BSP is a swap rather than a rewrite. Template
 * approval takes one to two weeks and the account is a program dependency
 * (B1) — building against a real API first would have stalled this part behind
 * paperwork, and building without an interface would have meant rewriting the
 * branch flow when the account arrived.
 */
export abstract class WhatsAppChannel {
  abstract readonly name: string;
  abstract send(outbound: OutboundMessage): Promise<SendResult>;
  /** Turns a provider webhook body into something the workflow understands. */
  abstract parseInbound(body: unknown): InboundReply | null;
}

/**
 * The development channel.
 *
 * Writes nowhere except the log — the *record* of the message is the
 * notification module's `message` table, written by the service around this.
 * That is deliberate: the dev outbox and the production delivery-receipt log
 * are the same table, so the flow being tested is the flow that ships.
 */
@Injectable()
export class MockWhatsAppChannel extends WhatsAppChannel {
  readonly name = 'mock';
  private readonly logger = new Logger('WhatsApp(mock)');

  send(outbound: OutboundMessage): Promise<SendResult> {
    this.logger.log(
      `→ ${outbound.toPhone} [${outbound.template}] ${JSON.stringify(outbound.payload)}` +
        (outbound.quickReplies?.length
          ? ` buttons=${outbound.quickReplies.join('|')}`
          : ''),
    );

    return Promise.resolve({ providerMessageId: `mock-${randomUUID()}`, accepted: true });
  }

  /**
   * Parses the shape the dev webhook posts.
   *
   * Meta's real payload is a deeply nested `entry[].changes[].value.messages[]`
   * envelope. Keeping the mock's shape flat is honest — pretending to be the
   * real envelope would make this look tested when the only thing tested is our
   * own invention. What matters is that both produce an `InboundReply`.
   */
  parseInbound(body: unknown): InboundReply | null {
    const candidate = body as {
      messageId?: string;
      from?: string;
      reply?: string;
      inReplyTo?: string;
    } | null;

    if (!candidate?.messageId || !candidate.from) return null;

    const tapped = candidate.reply ?? '';

    return {
      providerMessageId: candidate.messageId,
      fromPhone: candidate.from,
      reply:
        isVendorReply(tapped) || isCustomerReply(tapped)
          ? (tapped as VendorReply | CustomerReply)
          : null,
      inReplyToProviderMessageId: candidate.inReplyTo,
      raw: (body ?? {}) as Record<string, unknown>,
    };
  }
}

export const WHATSAPP_CHANNEL = Symbol('WHATSAPP_CHANNEL');
export const CHANNEL = NotificationChannel.WHATSAPP;
