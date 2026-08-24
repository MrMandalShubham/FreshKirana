import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AnalyticsEvent, type Principal } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Public } from '../../identity/contracts';
import { ServiceAreaService } from './service-area.service';
import { SlotService } from './slot.service';

export class CheckServiceabilityDto {
  @Type(() => Number) @IsLatitude() latitude!: number;
  @Type(() => Number) @IsLongitude() longitude!: number;
}

export class SlotQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(7) days?: number;
}

export class JoinWaitlistDto {
  @Type(() => Number) @IsLatitude() latitude!: number;
  @Type(() => Number) @IsLongitude() longitude!: number;

  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be six digits' })
  pincode!: string;

  @IsOptional() @IsString() @MaxLength(120) city?: string;

  @IsOptional()
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'contactPhone must be +91XXXXXXXXXX' })
  contactPhone?: string;
}

/**
 * "Do you deliver here, and when?" (spec §2.8).
 *
 * `@Public` because this is asked *before* signup — it is the second thing a
 * visitor does after landing, and putting a login in front of it means the
 * answer "no, not yet" costs them an account they will never use.
 */
@Controller('serviceability')
export class ServiceabilityController {
  constructor(
    private readonly areas: ServiceAreaService,
    private readonly slots: SlotService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Which stores serve this pin.
   *
   * An empty list is a legitimate answer, not an error: §2.8.1 requires a clear
   * "not yet serviceable" state with waitlist capture, which is a 200 with
   * nothing in it plus somewhere to go next.
   */
  @Public()
  @Get('check')
  async check(
    @Query() query: CheckServiceabilityDto,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const stores = await this.areas.resolveStores(query);

    void this.analytics.emit(AnalyticsEvent.SERVICEABILITY_CHECKED, {
      accountId: principal?.accountId ?? null,
      anonId: 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: { serviceable: stores.length > 0, storeCount: stores.length },
    });

    return {
      serviceable: stores.length > 0,
      stores,
      /** What the UI should offer when there is nothing: §2.8.1 waitlist. */
      waitlistAvailable: stores.length === 0,
    };
  }

  @Public()
  @Get('stores/:branchId/slots')
  slotsFor(@Param('branchId') branchId: string, @Query() query: SlotQueryDto) {
    return this.slots.listSlots(branchId, { days: query.days });
  }

  @Public()
  @Post('waitlist')
  async join(
    @Body() dto: JoinWaitlistDto,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const entry = await this.areas.joinWaitlist({
      ...dto,
      accountId: principal?.accountId ?? null,
    });

    // Rule R1. `pincode` is the property that makes this actionable: §1.11 asks
    // *where* to open next, and an undifferentiated count cannot answer it.
    void this.analytics.emit(AnalyticsEvent.WAITLIST_JOINED, {
      accountId: principal?.accountId ?? null,
      anonId: 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: { pincode: dto.pincode, city: dto.city },
    });

    return entry;
  }
}
