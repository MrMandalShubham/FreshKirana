import { Module } from '@nestjs/common';
import { PricingService } from './internal/pricing.service';

/**
 * Pricing module — fees, and later discounts and coupons (spec §2.2, §1.3.1).
 *
 * Owns no tables yet: fees are configuration. The `pricing` PostgreSQL schema
 * exists for the coupon and discount rules that arrive with P3.x.
 */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
