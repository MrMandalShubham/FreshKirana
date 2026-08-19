import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CartModule } from '../cart/cart.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { UserModule } from '../user/user.module';
import { CheckoutController } from './internal/checkout.controller';
import { CheckoutService } from './internal/checkout.service';

/**
 * Checkout module — orchestration, and no tables of its own (spec §2.2).
 *
 * Everything it touches belongs to another module, reached through that
 * module's contracts. That is the point: the sequence "validate → book → write
 * → close the cart" is the thing that changes when payments (P3.2) and
 * reservations (P3.1) arrive, and keeping it in one place with no schema of its
 * own means those parts extend a workflow rather than rewrite five modules.
 */
@Module({
  imports: [
    IdentityModule,
    AnalyticsModule,
    CartModule,
    UserModule,
    ServiceabilityModule,
    OrderModule,
    InventoryModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
