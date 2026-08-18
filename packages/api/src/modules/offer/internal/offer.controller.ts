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
import { CreateOfferDto, ListOffersQueryDto, UpdateOfferDto } from './offer.dto';
import { OfferService } from './offer.service';

/**
 * A vendor's listings: price, stock, availability (spec §1.5.2).
 *
 * Every route is scoped by `:vendorId` and guarded by `VendorScopeGuard`, so a
 * shop's staff can only ever reach their own shop's offers (§3.2).
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId/offers')
export class OfferController {
  constructor(private readonly offers: OfferService) {}

  @Post()
  create(@Param('vendorId') vendorId: string, @Body() dto: CreateOfferDto) {
    return this.offers.create(vendorId, dto);
  }

  @Get()
  list(@Param('vendorId') vendorId: string, @Query() query: ListOffersQueryDto) {
    return this.offers.listForVendor(vendorId, query);
  }

  @Get(':offerId')
  get(@Param('vendorId') vendorId: string, @Param('offerId') offerId: string) {
    return this.offers.findForVendor(vendorId, offerId);
  }

  @Patch(':offerId')
  update(
    @Param('vendorId') vendorId: string,
    @Param('offerId') offerId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(vendorId, offerId, dto);
  }
}
