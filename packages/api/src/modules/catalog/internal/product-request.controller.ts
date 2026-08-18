import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles, VendorScopeGuard } from '../../identity/contracts';
import { CreateProductRequestDto } from './catalog.dto';
import { ProductRequestService } from './product-request.service';

/**
 * The vendor's side of the product-request queue (spec §1.9.1).
 *
 * Scoped by `:vendorId` so a shop can only submit and read its own requests —
 * another shop's requests reveal what they are about to stock.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId/product-requests')
export class ProductRequestController {
  constructor(private readonly requests: ProductRequestService) {}

  @Post()
  submit(
    @Param('vendorId') vendorId: string,
    @Body() dto: CreateProductRequestDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.requests.submit(vendorId, principal?.accountId ?? null, dto);
  }

  @Get()
  list(@Param('vendorId') vendorId: string, @Query('status') status?: string) {
    return this.requests.listForVendor(vendorId, status);
  }
}
