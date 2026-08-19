import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationModule } from '../notification/notification.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { VendorModule } from '../vendor/vendor.module';
import { OrderStateService } from './internal/order-state.service';
import {
  OrderController,
  OrderTransitionController,
  UsualBasketController,
  VendorOrderController,
} from './internal/order.controller';
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
    VendorModule,
  ],
  controllers: [
    OrderController,
    UsualBasketController,
    VendorOrderController,
    OrderTransitionController,
    WhatsAppWebhookController,
    VendorSlaController,
    VendorMessagesController,
  ],
  providers: [
    OrderService,
    OrderStateService,
    VendorOrderFlowService,
    UsualBasketService,
  ],
  exports: [OrderService, OrderStateService, VendorOrderFlowService, UsualBasketService],
})
export class OrderModule {}
