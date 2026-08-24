import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles, BranchScopeGuard } from '../../identity/contracts';
import { CreateProductRequestDto } from './catalog.dto';
import { ProductRequestService } from './product-request.service';

/**
 * The branch's side of the product-request queue (spec §1.9.1).
 *
 * Scoped by `:branchId` so a shop can only submit and read its own requests —
 * another shop's requests reveal what they are about to stock.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId/product-requests')
export class ProductRequestController {
  constructor(private readonly requests: ProductRequestService) {}

  @Post()
  submit(
    @Param('branchId') branchId: string,
    @Body() dto: CreateProductRequestDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.requests.submit(branchId, principal?.accountId ?? null, dto);
  }

  @Get()
  list(@Param('branchId') branchId: string, @Query('status') status?: string) {
    return this.requests.listForVendor(branchId, status);
  }
}
