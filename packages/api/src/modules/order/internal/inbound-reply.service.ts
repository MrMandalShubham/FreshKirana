import { Injectable, Logger } from '@nestjs/common';
import {
  CustomerReply,
  NotificationTemplate,
  isCustomerReply,
} from '@freshkirana/contracts';
import { NotificationService } from '../../notification/contracts';
import { CodFlowService } from './cod-flow.service';
import type { InboundOutcome } from './branch-order-flow.service';
import { BranchOrderFlowService } from './branch-order-flow.service';

/**
 * Who tapped the button (spec §1.9.3, §2.10.4).
 *
 * Stores and customers both reply on the same webhook, and the two vocabularies
 * are deliberately disjoint (`ACCEPT`/`REJECT` versus `CONFIRM`/`DECLINE`) so
 * this can tell them apart without guessing from the phone number — a shop
 * owner ordering their own groceries would defeat that.
 *
 * Exists as its own service to keep the dependency acyclic: it depends on both
 * flows, and neither depends on it. Folding this branch into the branch flow
 * would have made the branch flow depend on the COD flow, which already depends
 * on the branch flow to announce a confirmed order.
 */
@Injectable()
export class InboundReplyService {
  private readonly logger = new Logger(InboundReplyService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly vendorFlow: BranchOrderFlowService,
    private readonly codFlow: CodFlowService,
  ) {}

  async handle(body: unknown): Promise<InboundOutcome> {
    const parsed = this.notifications.parseInbound(body);
    if (!parsed) return { handled: false, reason: 'UNPARSEABLE' };

    // Parsing is pure and has no side effects, so doing it here and again in
    // whichever branch runs costs nothing and keeps each flow self-contained.
    if (!parsed.reply || !isCustomerReply(parsed.reply)) {
      return this.vendorFlow.handleInbound(body);
    }

    return this.handleCustomerReply(parsed);
  }

  private async handleCustomerReply(
    parsed: NonNullable<ReturnType<NotificationService['parseInbound']>>,
  ): Promise<InboundOutcome> {
    const original = parsed.inReplyToProviderMessageId
      ? await this.notifications.findByProviderMessageId(
          parsed.inReplyToProviderMessageId,
        )
      : await this.notifications.lastAwaitingReply(
          parsed.fromPhone,
          NotificationTemplate.COD_CONFIRM,
        );

    const record = await this.notifications.recordInbound(parsed, {
      orderId: original?.orderId ?? null,
      inReplyToMessageId: original?.id ?? null,
    });

    // The provider retried. The first delivery already did the work.
    if (!record.isNew) return { handled: false, reason: 'ALREADY_HANDLED' };

    if (!original?.orderId) {
      await this.notifications.recordOutcome(record.id, 'NO_MATCHING_ORDER');
      return { handled: false, reason: 'NO_MATCHING_ORDER' };
    }

    try {
      const order =
        parsed.reply === CustomerReply.CONFIRM
          ? await this.codFlow.confirm(original.orderId)
          : await this.codFlow.decline(original.orderId);

      await this.notifications.recordOutcome(record.id, `MOVED_TO_${order.status}`);
      return { handled: true, orderId: order.id, status: order.status };
    } catch (error) {
      // A customer tapping a button on an order that already expired. Their
      // button was stale — not their mistake, and it must not read as an error.
      const outcome = `REFUSED: ${error instanceof Error ? error.message : String(error)}`;
      await this.notifications.recordOutcome(record.id, outcome.slice(0, 500));
      this.logger.warn(`Customer reply could not be applied: ${outcome}`);

      return { handled: false, reason: 'TRANSITION_REFUSED', orderId: original.orderId };
    }
  }
}
