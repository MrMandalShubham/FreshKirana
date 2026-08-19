import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Roles, Public } from '../../identity/contracts';
import { Role } from '@freshkirana/contracts';
import { PaymentFlowService } from './payment-flow.service';

/**
 * The gateway's webhook (spec §2.10.2).
 *
 * `@Public` because the caller is Razorpay, not a signed-in user. Authenticity
 * is the signature — which is why this is the one route in the codebase that
 * reads the **raw** body: the signature is over bytes, and a re-serialised JSON
 * body can have different whitespace and key order. Verifying a re-serialised
 * body rejects good webhooks and, worse, can be made to accept bad ones.
 */
@Controller('webhooks/razorpay')
export class PaymentWebhookController {
  constructor(private readonly flow: PaymentFlowService) {}

  /**
   * Always 200.
   *
   * A gateway that receives an error retries, and retrying a body we rejected
   * as unsigned achieves nothing except doing it again. The body says what
   * happened; the status says we received it.
   */
  @Public()
  @Post()
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    const raw = request.rawBody?.toString('utf8') ?? '';
    return this.flow.handleWebhook(raw, signature);
  }
}

/**
 * The reconciliation loop, on demand (§2.11.3).
 *
 * Normally driven by a Cloud Run job every few minutes. Exposed for an operator
 * who needs to force a pass during an incident — which is exactly when a
 * scheduled job feels too slow.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/payments')
export class PaymentReconciliationController {
  constructor(private readonly flow: PaymentFlowService) {}

  @Post('reconcile')
  reconcile() {
    return this.flow.reconcilePending();
  }
}
