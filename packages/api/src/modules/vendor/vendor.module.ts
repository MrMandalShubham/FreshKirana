import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  VendorAdminController,
  VendorSelfController,
} from './internal/vendor.controller';
import { VendorService } from './internal/vendor.service';

/**
 * Vendor module — shops, onboarding, KYC (spec §2.2).
 *
 * Owns the `vendor` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Imports identity because staff membership is a vendor-scoped *role*, held in
 * that module rather than duplicated here (§3.2).
 */
@Module({
  imports: [IdentityModule],
  controllers: [VendorAdminController, VendorSelfController],
  providers: [VendorService],
  exports: [VendorService],
})
export class VendorModule {}
