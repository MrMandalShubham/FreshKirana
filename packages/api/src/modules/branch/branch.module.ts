import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  BranchAdminController,
  BranchSelfController,
} from './internal/branch.controller';
import { BranchService } from './internal/branch.service';

/**
 * Branch module — shops, onboarding, KYC (spec §2.2).
 *
 * Owns the `branch` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Imports identity because staff membership is a branch-scoped *role*, held in
 * that module rather than duplicated here (§3.2).
 */
@Module({
  imports: [IdentityModule],
  controllers: [BranchAdminController, BranchSelfController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
