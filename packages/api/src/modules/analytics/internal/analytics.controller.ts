import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Platform } from '@freshkirana/contracts';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Public } from '../../identity/contracts';
import type { Principal } from '../../identity/contracts';
import { AnalyticsService } from './analytics.service';

export class TrackEventDto {
  @IsString() @MaxLength(200) eventId!: string;
  @IsString() @MaxLength(100) event!: string;
  @IsISO8601() occurredAt!: string;

  @IsString() @MaxLength(200) anonId!: string;
  @IsString() @MaxLength(200) sessionId!: string;

  @IsIn(Object.values(Platform)) platform!: Platform;

  @IsOptional() @IsString() @MaxLength(50) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;

  @IsOptional() @IsObject() experimentVariants?: Record<string, string>;
  @IsOptional() @IsObject() properties?: Record<string, unknown>;
}

export class TrackBatchDto {
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events!: TrackEventDto[];
}

/**
 * Analytics ingest (spec §5.3).
 *
 * Public: the funnel starts before signup, so anonymous sessions must be able
 * to report. When a caller *is* authenticated the principal is used rather than
 * any client-supplied id, so a client cannot attribute events to someone else.
 */
@Controller('events')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Post()
  @HttpCode(202)
  async track(@Body() dto: TrackEventDto, @CurrentUser() principal?: Principal) {
    return this.analytics.track({ ...dto, accountId: principal?.accountId ?? null });
  }

  /** Batch ingest — the PWA buffers events and flushes on a timer or unload. */
  @Public()
  @Post('batch')
  @HttpCode(202)
  async trackBatch(@Body() dto: TrackBatchDto, @CurrentUser() principal?: Principal) {
    const results = await Promise.allSettled(
      dto.events.map((e) =>
        this.analytics.track({ ...e, accountId: principal?.accountId ?? null }),
      ),
    );

    return {
      accepted: results.filter((r) => r.status === 'fulfilled').length,
      rejected: results
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.status === 'rejected')
        .map(({ i }) => ({ index: i, event: dto.events[i]?.event })),
    };
  }
}
