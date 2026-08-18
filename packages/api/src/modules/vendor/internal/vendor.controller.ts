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
import { Roles, VendorScopeGuard } from '../../identity/contracts';
import { AddVendorStaffDto, CreateVendorDto, UpdateVendorDto } from './vendor.dto';
import { VendorService } from './vendor.service';

/** Vendor administration: onboarding, approval, suspension (spec §1.5.4). */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/vendors')
export class VendorAdminController {
  constructor(private readonly vendors: VendorService) {}

  @Post()
  create(@Body() dto: CreateVendorDto) {
    return this.vendors.create(dto);
  }

  @Get()
  list(@Query('status') status?: string, @Query('city') city?: string) {
    return this.vendors.list({ status, city });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vendors.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.vendors.update(id, dto);
  }

  @Post(':id/staff')
  addStaff(@Param('id') id: string, @Body() dto: AddVendorStaffDto) {
    return this.vendors.addStaff(id, dto);
  }
}

/**
 * The vendor's own view of their store.
 *
 * `VendorScopeGuard` reads `:vendorId` and requires a role held **at that
 * vendor** (§3.2). Without it, `@Roles(VENDOR_OWNER, VENDOR_STAFF)` would let
 * any shop's staff read any other shop's store — the role is identical
 * everywhere; only the scope differs.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId')
export class VendorSelfController {
  constructor(private readonly vendors: VendorService) {}

  @Get('profile')
  profile(@Param('vendorId') vendorId: string) {
    return this.vendors.findById(vendorId);
  }
}
