import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { OrderStatus, type Principal, Role } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser, Roles, VendorScopeGuard } from '../../identity/contracts';
import { OrderService } from './order.service';

export class ListOrdersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class ListVendorOrdersQueryDto extends ListOrdersQueryDto {
  @IsOptional() @IsIn(Object.values(OrderStatus)) status?: string;
}

/**
 * The shopper's own orders (spec §1.5.1).
 *
 * Scoped to the caller's account rather than taking an account id from the
 * path: "someone else's order" is not expressible in this API (§3.2).
 */
@Controller('me/orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list(@CurrentUser() principal: Principal, @Query() query: ListOrdersQueryDto) {
    return this.orders.listForAccount(principal.accountId, query);
  }

  @Get(':orderId')
  get(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    return this.orders.findForAccount(principal.accountId, orderId);
  }
}

/**
 * A store's order queue.
 *
 * The vendor-facing surface proper is P2.5 and P7.1; this is the read the
 * store needs to see that an order arrived at all.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId/orders')
export class VendorOrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list(@Param('vendorId') vendorId: string, @Query() query: ListVendorOrdersQueryDto) {
    return this.orders.listForVendor(vendorId, query);
  }
}
