import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@freshkirana/contracts';
import { Roles, BranchScopeGuard } from '../../identity/contracts';
import { AddBranchStaffDto, CreateBranchDto, UpdateBranchDto } from './branch.dto';
import { BranchService } from './branch.service';

/** Branch administration: onboarding, approval, suspension (spec §1.5.4). */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/branches')
export class BranchAdminController {
  constructor(private readonly branches: BranchService) {}

  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Get()
  list(@Query('status') status?: string, @Query('city') city?: string) {
    return this.branches.list({ status, city });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.branches.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Post(':id/staff')
  addStaff(@Param('id') id: string, @Body() dto: AddBranchStaffDto) {
    return this.branches.addStaff(id, dto);
  }
}

/**
 * The branch's own view of their store.
 *
 * `BranchScopeGuard` reads `:branchId` and requires a role held **at that
 * branch** (§3.2). Without it, `@Roles(VENDOR_OWNER, VENDOR_STAFF)` would let
 * any shop's staff read any other shop's store — the role is identical
 * everywhere; only the scope differs.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId')
export class BranchSelfController {
  constructor(private readonly branches: BranchService) {}

  @Get('profile')
  profile(@Param('branchId') branchId: string) {
    return this.branches.findById(branchId);
  }
}
