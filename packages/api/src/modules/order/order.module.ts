import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IdentityModule } from '../identity/identity.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { OrderStateService } from './internal/order-state.service';
import {
  OrderController,
  OrderTransitionController,
  VendorOrderController,
} from './internal/order.controller';
import { OrderService } from './internal/order.service';

/**
 * Order module — the canonical order, its lines, and the §2.6 state machine.
 *
 * Owns the `order` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Depends on `serviceability` for one reason: cancelling releases the delivery
 * slot, and that has to happen in the same transaction as the status change.
 */
@Module({
  imports: [IdentityModule, AnalyticsModule, ServiceabilityModule],
  controllers: [OrderController, VendorOrderController, OrderTransitionController],
  providers: [OrderService, OrderStateService],
  exports: [OrderService, OrderStateService],
})
export class OrderModule {}
