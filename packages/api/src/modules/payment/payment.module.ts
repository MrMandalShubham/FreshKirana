import { Logger, Module } from '@nestjs/common';
import { PaymentService } from './internal/payment.service';
import { RefundService } from './internal/refund.service';
import { LiveRazorpayProvider } from './internal/razorpay.live-provider';
import { MockRazorpayProvider, PAYMENT_PROVIDER } from './internal/razorpay.provider';

/**
 * Payment module — gateway integration, webhooks, capture (spec §2.10).
 *
 * Owns the `payment` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Knows about money and nothing about orders. What a captured payment *means*
 * is the order module's business — which is what kept the provider swap
 * (decision B3) to this file plus an implementation.
 */
@Module({
  providers: [
    PaymentService,
    RefundService,
    MockRazorpayProvider,
    LiveRazorpayProvider,
    {
      provide: PAYMENT_PROVIDER,
      /**
       * Credentials decide which gateway runs.
       *
       * Without a key id there is nothing to authenticate with, so the mock
       * stays: a deployment missing its credentials cannot take real payments,
       * but it boots, serves the catalog, and takes COD orders. Refusing to
       * start would turn a missing secret into a total outage.
       *
       * The log line is deliberate. "Which provider is live?" is the first
       * question anyone asks when a payment does not appear, and it should be
       * answerable from the startup logs rather than by reading environment
       * variables in a console.
       */
      useFactory: (live: LiveRazorpayProvider, mock: MockRazorpayProvider) => {
        const configured = LiveRazorpayProvider.isConfigured();

        new Logger('PaymentModule').log(
          configured
            ? 'Razorpay credentials present — using the live gateway'
            : 'No RAZORPAY_KEY_ID — using the mock gateway; real payments will not work',
        );

        return configured ? live : mock;
      },
      inject: [LiveRazorpayProvider, MockRazorpayProvider],
    },
  ],
  exports: [PaymentService, RefundService, MockRazorpayProvider],
})
export class PaymentModule {}
