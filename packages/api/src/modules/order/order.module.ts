import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CodModule } from '../cod/cod.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentModule } from '../payment/payment.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { VendorModule } from '../vendor/vendor.module';
import { CodFlowService } from './internal/cod-flow.service';
import {
  CodConfirmationController,
  CodOverrideController,
  CodSweepController,
} from './internal/cod-flow.controller';
import { InboundReplyService } from './internal/inbound-reply.service';
import { RefundFlowService } from './internal/refund-flow.service';
import {
  AdminRefundController,
  CustomerRefundController,
} from './internal/refund.controller';
import { OrderStateService } from './internal/order-state.service';
import {
  OrderController,
  OrderTransitionController,
  UsualBasketController,
  VendorOrderController,
} from './internal/order.controller';
import { PaymentFlowService } from './internal/payment-flow.service';
import {
  PaymentLinkController,
  PaymentRecoveryController,
} from './internal/payment-recovery.controller';
import { PaymentRecoveryService } from './internal/payment-recovery.service';
import {
  PaymentReconciliationController,
  PaymentWebhookController,
} from './internal/payment-webhook.controller';
import { OrderService } from './internal/order.service';
import { UsualBasketService } from './internal/usual-basket.service';
import {
  VendorMessagesController,
  VendorSlaController,
  WhatsAppWebhookController,
} from './internal/vendor-order-flow.controller';
import { VendorOrderFlowService } from './internal/vendor-order-flow.service';

/**
 * Order module — the canonical order, the §2.6 state machine, and the store's
 * WhatsApp flow (§1.9.3).
 *
 * Owns the `order` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Depends on `serviceability` because cancelling releases the delivery slot in
 * the same transaction, on `notification` to reach the store, and on `vendor`
 * for the number to reach it at. The dependency runs one way — notification
 * knows nothing about orders — which is why the half that decides what a tapped
 * button means lives here.
 */
@Module({
  imports: [
    IdentityModule,
    AnalyticsModule,
    ServiceabilityModule,
    NotificationModule,
    InventoryModule,
    PaymentModule,
    VendorModule,
    // Switching a failed payment to cash is a credit decision, so it goes
    // through the same §2.17.2 scorer P3.4's confirmation flow will use.
    CodModule,
  ],
  controllers: [
    OrderController,
    UsualBasketController,
    VendorOrderController,
    OrderTransitionController,
    WhatsAppWebhookController,
    VendorSlaController,
    VendorMessagesController,
    PaymentWebhookController,
    PaymentReconciliationController,
    PaymentRecoveryController,
    PaymentLinkController,
    CodConfirmationController,
    CodOverrideController,
    CodSweepController,
    CustomerRefundController,
    AdminRefundController,
  ],
  providers: [
    OrderService,
    OrderStateService,
    VendorOrderFlowService,
    UsualBasketService,
    PaymentFlowService,
    PaymentRecoveryService,
    CodFlowService,
    InboundReplyService,
    RefundFlowService,
  ],
  exports: [
    OrderService,
    OrderStateService,
    VendorOrderFlowService,
    UsualBasketService,
    PaymentFlowService,
    PaymentRecoveryService,
    CodFlowService,
    RefundFlowService,
  ],
})
export class OrderModule {}
