import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  type AnalyticsEvent,
  type Platform,
  findForbiddenProperties,
  isAnalyticsEvent,
} from '@freshkirana/contracts';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { getCorrelationId } from '../../../observability/correlation';
import { logger } from '../../../observability/logger';
import {
  analyticsEventsIngested,
  analyticsEventsRejected,
} from '../../../observability/metrics';
import { event } from '../schema';

export interface TrackInput {
  eventId: string;
  event: string;
  occurredAt: string;
  accountId?: string | null;
  anonId: string;
  sessionId: string;
  platform: string;
  appVersion?: string | null;
  city?: string | null;
  experimentVariants?: Record<string, string>;
  properties?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Validates and stores one event.
   *
   * Two rejections are deliberate and non-negotiable:
   *  - an undeclared event name, so the catalogue cannot silently drift (R1)
   *  - any personal data in properties, screened before it is written (§5.3)
   *
   * Duplicate `eventId`s are dropped, not stored, because clients retry.
   */
  async track(input: TrackInput): Promise<{ accepted: boolean; duplicate: boolean }> {
    if (!isAnalyticsEvent(input.event)) {
      analyticsEventsRejected.inc({ reason: 'unknown_event' });
      throw new BadRequestException(
        `Unknown analytics event "${input.event}". Declare it in @freshkirana/contracts (rule R1).`,
      );
    }

    const properties = input.properties ?? {};
    const forbidden = findForbiddenProperties(properties);
    if (forbidden.length > 0) {
      analyticsEventsRejected.inc({ reason: 'forbidden_property' });
      throw new BadRequestException(
        `Personal data must not be sent to analytics (§5.3). Offending: ${forbidden.join(', ')}`,
      );
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      analyticsEventsRejected.inc({ reason: 'bad_timestamp' });
      throw new BadRequestException('occurredAt must be a valid ISO-8601 timestamp');
    }

    const inserted = await this.db
      .insert(event)
      .values({
        eventId: input.eventId,
        name: input.event,
        occurredAt,
        accountId: input.accountId ?? null,
        anonId: input.anonId,
        sessionId: input.sessionId,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        city: input.city ?? null,
        experimentVariants: input.experimentVariants ?? {},
        properties,
        correlationId: getCorrelationId() ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: event.id });

    const duplicate = inserted.length === 0;
    if (!duplicate) {
      analyticsEventsIngested.inc({ event: input.event });
    }

    return { accepted: true, duplicate };
  }

  /**
   * Server-side emit for other modules (rule R1).
   *
   * Never throws: a failed analytics write must not fail the business
   * operation that produced it. Failures are logged and counted instead.
   */
  async emit(
    name: AnalyticsEvent,
    input: Omit<TrackInput, 'event' | 'eventId' | 'occurredAt' | 'platform'> & {
      eventId?: string;
      platform?: Platform;
    },
  ): Promise<void> {
    try {
      await this.track({
        ...input,
        eventId: input.eventId ?? crypto.randomUUID(),
        event: name,
        occurredAt: new Date().toISOString(),
        platform: input.platform ?? 'server',
      });
    } catch (error) {
      analyticsEventsRejected.inc({ reason: 'emit_failed' });
      logger.error({ err: error, event: name }, 'analytics emit failed');
    }
  }
}
