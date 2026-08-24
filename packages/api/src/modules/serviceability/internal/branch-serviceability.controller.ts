import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, ServiceAreaMode, StoredSlotStatus } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Roles, BranchScopeGuard } from '../../identity/contracts';
import { type PolygonGeoJson, ServiceAreaService } from './service-area.service';
import { SlotQueryDto } from './serviceability.controller';
import { SlotService } from './slot.service';

export class SetServiceAreaDto {
  @IsIn(Object.values(ServiceAreaMode)) mode!: string;

  @Type(() => Number) @IsLatitude() centreLatitude!: number;
  @Type(() => Number) @IsLongitude() centreLongitude!: number;

  /** Up to 25 km. Beyond that it is not a grocery delivery, it is a courier. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(25_000) radiusMeters?: number;

  /** GeoJSON Polygon. Coordinates are [longitude, latitude]. */
  @IsOptional() @IsObject() polygon?: PolygonGeoJson;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DefineSlotDto {
  /** 0 = Sunday. */
  @Type(() => Number) @IsInt() @Min(0) @Max(6) dayOfWeek!: number;

  /** Minutes from midnight IST: 600 is 10:00. */
  @Type(() => Number) @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) endMinute!: number;

  @Type(() => Number) @IsInt() @Min(0) @Max(500) pickingCapacityOrders!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(500) deliveryCapacityOrders!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  cutoffMinutesBefore?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetSlotStatusDto {
  @IsIn(Object.values(StoredSlotStatus)) status!: StoredSlotStatus;
}

/**
 * A store's own service area and slot pattern (spec §2.8).
 *
 * Scoped by `:branchId` and guarded by `BranchScopeGuard`, like every other
 * branch route: a shop's staff reach their own shop and nothing else (§3.2).
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId')
export class BranchServiceabilityController {
  constructor(
    private readonly areas: ServiceAreaService,
    private readonly slots: SlotService,
  ) {}

  @Put('service-area')
  setServiceArea(@Param('branchId') branchId: string, @Body() dto: SetServiceAreaDto) {
    return this.areas.setForVendor(branchId, dto);
  }

  @Get('service-area')
  getServiceArea(@Param('branchId') branchId: string) {
    return this.areas.findForVendor(branchId);
  }

  @Put('slot-definitions')
  defineSlot(@Param('branchId') branchId: string, @Body() dto: DefineSlotDto) {
    return this.slots.defineSlot(branchId, dto);
  }

  @Get('slot-definitions')
  listDefinitions(@Param('branchId') branchId: string) {
    return this.slots.listDefinitions(branchId);
  }

  @Delete('slot-definitions/:definitionId')
  async removeDefinition(
    @Param('branchId') branchId: string,
    @Param('definitionId') definitionId: string,
  ) {
    await this.slots.removeDefinition(branchId, definitionId);
    return { removed: true };
  }

  /** The store's own view of its slots, including how full each one is. */
  @Get('slots')
  listSlots(@Param('branchId') branchId: string, @Query() query: SlotQueryDto) {
    return this.slots.listSlots(branchId, { days: query.days });
  }

  /** Close a slot for a holiday, festival, or an ops-declared closure. */
  @Patch('slots/:slotInstanceId')
  setSlotStatus(
    @Param('branchId') branchId: string,
    @Param('slotInstanceId') slotInstanceId: string,
    @Body() dto: SetSlotStatusDto,
  ) {
    return this.slots.setStatus(branchId, slotInstanceId, dto.status);
  }
}
