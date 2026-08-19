import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AnalyticsEvent,
  Audience,
  OrderStatus,
  type Principal,
  Role,
  customerTimeline,
  hasRoleAtVendor,
} from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Roles, VendorScopeGuard } from '../../identity/contracts';
import { OrderStateService } from './order-state.service';
import { OrderService } from './order.service';

export class ListOrdersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class ListVendorOrdersQueryDto extends ListOrdersQueryDto {
  @IsOptional() @IsIn(Object.values(OrderStatus)) status?: string;
}

export class TransitionDto {
  @IsIn(Object.values(OrderStatus)) to!: OrderStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * The shopper's own orders (spec §1.5.1, §2.6.3).
 *
 * Everything here speaks the **customer** vocabulary: "Being packed", not
 * PICKING. The canonical state travels too, because the app needs something
 * stable to branch on, but the string a person reads is the label.
 */
@Controller('me/orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  async list(@CurrentUser() principal: Principal, @Query() query: ListOrdersQueryDto) {
    const orders = await this.orders.listForAccount(principal.accountId, query);
    return orders.map((order) => this.forCustomer(order));
  }

  @Get(':orderId')
  async get(@CurrentUser() principal: Principal, @Param('orderId') orderId: string) {
    const order = await this.orders.findForAccount(principal.accountId, orderId);
    const history = await this.state.history(orderId);

    return {
      ...this.forCustomer(order),
      history,
      // Built from history, not from the row: "confirmed at 6:04pm" is what a
      // waiting customer wants, and only the audit trail knows it.
      timeline: customerTimeline(order.status as OrderStatus, history),
    };
  }

  /**
   * Cancels, within the §1.8.1 window.
   *
   * A dedicated route rather than a generic transition: cancelling is the only
   * state change a customer initiates, and naming it means the client never has
   * to know the state machine's vocabulary to do the one thing it needs.
   */
  @Post(':orderId/cancel')
  async cancel(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    const { order } = await this.state.transition(
      orderId,
      OrderStatus.CANCELLED,
      { accountId: principal.accountId, role: Role.CUSTOMER },
      { reason: dto.reason, accountId: principal.accountId },
    );

    void this.analytics.emit(AnalyticsEvent.ORDER_CANCELLED, {
      accountId: principal.accountId,
      anonId: 'account',
      sessionId: 'unknown',
      properties: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        cancelledBy: Role.CUSTOMER,
        grandTotalPaise: order.grandTotalPaise,
      },
    });

    return this.forCustomer(order);
  }

  private forCustomer<T extends { status: string }>(order: T) {
    return {
      ...order,
      label: this.state.label(order.status as OrderStatus, Audience.CUSTOMER),
      nextActions: this.state.nextFor(order.status as OrderStatus, Role.CUSTOMER),
    };
  }
}

/**
 * A store's order queue, in the **vendor** vocabulary (§2.6.3).
 *
 * The same order that reads "Being packed" to a customer reads "Picking" here.
 * One canonical state, two words for it — never two state machines.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(VendorScopeGuard)
@Controller('vendor/:vendorId/orders')
export class VendorOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly state: OrderStateService,
  ) {}

  @Get()
  async list(
    @CurrentUser() principal: Principal,
    @Param('vendorId') vendorId: string,
    @Query() query: ListVendorOrdersQueryDto,
  ) {
    const orders = await this.orders.listForVendor(vendorId, query);
    const role = this.roleAt(principal, vendorId);

    return orders.map((order) => ({
      ...order,
      label: this.state.label(order.status as OrderStatus, Audience.VENDOR),
      nextActions: this.state.nextFor(order.status as OrderStatus, role),
    }));
  }

  @Post(':orderId/transitions')
  async transition(
    @CurrentUser() principal: Principal,
    @Param('vendorId') vendorId: string,
    @Param('orderId') orderId: string,
    @Body() dto: TransitionDto,
  ) {
    const { order } = await this.state.transition(
      orderId,
      dto.to,
      { accountId: principal.accountId, role: this.roleAt(principal, vendorId) },
      { reason: dto.reason, vendorId },
    );

    return {
      ...order,
      label: this.state.label(order.status as OrderStatus, Audience.VENDOR),
    };
  }

  /**
   * The role this principal actually holds *at this store* (§3.2).
   *
   * The guard has already confirmed they may be here; this decides what the
   * transition table lets them do. Taking `principal.roles[0]` instead would let
   * someone who is staff at one store act with an admin role they hold globally.
   */
  private roleAt(principal: Principal, vendorId: string): Role {
    if (hasRoleAtVendor(principal, vendorId, Role.VENDOR_OWNER)) return Role.VENDOR_OWNER;
    if (hasRoleAtVendor(principal, vendorId, Role.VENDOR_STAFF)) return Role.VENDOR_STAFF;
    return principal.roles.some((role) => role.role === Role.ADMIN)
      ? Role.ADMIN
      : Role.OPS;
  }
}

/**
 * Riders, fleet managers and ops.
 *
 * The rider surface proper is P6.2; this is the transition endpoint it will
 * call. Ops are here because reality does not follow the diagram, and a
 * correction made through this route leaves an audit row — a correction made
 * with `UPDATE` leaves nothing (§3.8).
 */
@Roles(Role.RIDER, Role.FLEET_MANAGER, Role.ADMIN, Role.OPS)
@Controller('orders')
export class OrderTransitionController {
  constructor(private readonly state: OrderStateService) {}

  @Post(':orderId/transitions')
  async transition(
    @CurrentUser() principal: Principal,
    @Param('orderId') orderId: string,
    @Body() dto: TransitionDto,
  ) {
    const role = this.highestRole(principal);

    const { order } = await this.state.transition(
      orderId,
      dto.to,
      {
        accountId: principal.accountId,
        role,
      },
      { reason: dto.reason },
    );

    return {
      ...order,
      label: this.state.label(order.status as OrderStatus, Audience.RIDER),
    };
  }

  @Get(':orderId/history')
  history(@Param('orderId') orderId: string) {
    return this.state.history(orderId);
  }

  /**
   * Which of the caller's roles to act as.
   *
   * Rider first: someone who is both a rider and ops is, when calling this
   * route, doing a rider's job. Ops authority is the fallback, not the default,
   * so an accidental delivery confirmation is not attributed to support.
   */
  private highestRole(principal: Principal): Role {
    const held = new Set(principal.roles.map((role) => role.role));
    for (const role of [Role.RIDER, Role.FLEET_MANAGER, Role.OPS, Role.ADMIN]) {
      if (held.has(role)) return role;
    }
    return Role.OPS;
  }
}
