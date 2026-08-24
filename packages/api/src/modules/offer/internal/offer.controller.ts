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
import { CreateOfferDto, ListOffersQueryDto, UpdateOfferDto } from './offer.dto';
import { OfferService } from './offer.service';

/**
 * A branch's listings: price, stock, availability (spec §1.5.2).
 *
 * Every route is scoped by `:branchId` and guarded by `BranchScopeGuard`, so a
 * shop's staff can only ever reach their own shop's offers (§3.2).
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId/offers')
export class OfferController {
  constructor(private readonly offers: OfferService) {}

  @Post()
  create(@Param('branchId') branchId: string, @Body() dto: CreateOfferDto) {
    return this.offers.create(branchId, dto);
  }

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: ListOffersQueryDto) {
    return this.offers.listForVendor(branchId, query);
  }

  @Get(':offerId')
  get(@Param('branchId') branchId: string, @Param('offerId') offerId: string) {
    return this.offers.findForVendor(branchId, offerId);
  }

  @Patch(':offerId')
  update(
    @Param('branchId') branchId: string,
    @Param('offerId') offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(branchId, offerId, dto);
  }
}
