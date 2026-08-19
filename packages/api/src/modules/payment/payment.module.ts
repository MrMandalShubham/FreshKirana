import { Module } from '@nestjs/common';
import { PaymentService } from './internal/payment.service';
import { MockRazorpayProvider, PAYMENT_PROVIDER } from './internal/razorpay.provider';

/**
 * Payment module — gateway integration, webhooks, capture (spec §2.10).
 *
 * Owns the `payment` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Knows about money and nothing about orders. What a captured payment *means*
 * is the order module's business — which is what keeps the provider swap
 * (decision B3) to this file plus an implementation.
 */
@Module({
  providers: [
    PaymentService,
    MockRazorpayProvider,
    { provide: PAYMENT_PROVIDER, useExisting: MockRazorpayProvider },
  ],
  exports: [PaymentService, MockRazorpayProvider],
})
export class PaymentModule {}
