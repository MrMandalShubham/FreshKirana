import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { CurrentUser, Roles, VendorScopeGuard } from '../../identity/contracts';
import { AcceptSubstitutionDto } from './substitution.dto';
import { SubstitutionService } from './substitution.service';

/**
 * The picker's side (spec §1.7.2).
 *
 * Marking a line out of stock is the only thing a shop does here. What happens
 * next is the customer's preference, not the picker's choice — a picker who
 * could decide would be deciding for somebody who already said what they
 * wanted.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId/orders/:orderId/lines/:lineId')
export class PickerSubstitutionController {
  constructor(private readonly substitutions: SubstitutionService) {}

  @Post('out-of-stock')
  markOutOfStock(
    @Param('vendorId') vendorId: string,
    @Param('orderId') orderId: string,
    @Param('lineId') lineId: string,
  ) {
    return this.substitutions.raise({ orderId, orderLineId: lineId, vendorId });
  }
}

/**
 * The customer's side (§1.7.2).
 *
 * Scoped to their own order throughout — "accept somebody else's substitution"
 * is not expressible here (§3.2).
 */
@Controller('me/orders/:orderId/substitutions')
export class SubstitutionController {
  constructor(private readonly substitutions: SubstitutionService) {}

  /** Everything that happened to this order's lines, and why. */
  @Get()
  list(@Param('orderId') orderId: string) {
    return this.substitutions.forOrder(orderId);
  }

  @Post(':substitutionId/accept')
  accept(
    @CurrentUser() principal: Principal,
    @Param('substitutionId') substitutionId: string,
    @Body() dto: AcceptSubstitutionDto,
  ) {
    return this.substitutions.accept({
      substitutionId,
      accountId: principal.accountId,
      vendorOfferId: dto.vendorOfferId,
      ...(dto.consented === undefined ? {} : { consented: dto.consented }),
    });
  }

  @Post(':substitutionId/reject')
  reject(
    @CurrentUser() principal: Principal,
    @Param('substitutionId') substitutionId: string,
  ) {
    return this.substitutions.reject({
      substitutionId,
      accountId: principal.accountId,
    });
  }
}

/**
 * The ten-minute sweep (§1.7.2).
 *
 * Driven by Cloud Scheduler for the reason every other sweep is: a timer inside
 * the API dies with the instance, and Cloud Run scales to zero. Without it an
 * unanswered question holds a picker in an aisle indefinitely.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/substitution-sweep')
export class SubstitutionSweepController {
  constructor(private readonly substitutions: SubstitutionService) {}

  @Post()
  run() {
    return this.substitutions.expireOverdue();
  }
}
