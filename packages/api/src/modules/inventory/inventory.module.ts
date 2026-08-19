import { Module } from '@nestjs/common';
import { OfferModule } from '../offer/offer.module';
import { InventoryService } from './internal/inventory.service';

/**
 * Inventory module — reservations, holds, release, oversell prevention
 * (spec §2.5, §2.2).
 *
 * Owns the `inventory` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Depends on `offer` because that module owns the stock counters. The split is
 * deliberate: offer knows how to move a number atomically, inventory knows why
 * it moved and can reconcile the two.
 */
@Module({
  imports: [OfferModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
