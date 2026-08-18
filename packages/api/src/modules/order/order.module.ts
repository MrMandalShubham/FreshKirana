import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrderController, VendorOrderController } from './internal/order.controller';
import { OrderService } from './internal/order.service';

/**
 * Order module — the canonical order and its lines (spec §2.6, §2.2).
 *
 * Owns the `order` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Deliberately knows nothing about carts, slots or addresses: checkout hands it
 * a complete, already-validated order. That is what keeps the canonical record
 * free of the sequence that produced it.
 */
@Module({
  imports: [IdentityModule],
  controllers: [OrderController, VendorOrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
