import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  type CodThresholds,
  DEFAULT_COD_THRESHOLDS,
  validateThresholds,
} from '@freshkirana/contracts';
import { eq } from 'drizzle-orm';
import { applyPatch } from '../../../common/merge-patch';
import { type Database, createDatabase } from '../../../db';
import { codConfig } from '../schema';

const CONFIG_KEY = 'default';

/**
 * How long a cached copy is trusted, in milliseconds.
 *
 * The honest cost of "without a deploy". Every request scoring a threshold
 * against the database would be a query on the checkout path for a value that
 * changes a few times a month — but a cache means instances disagree until it
 * expires. Thirty seconds is short enough that an operator watching a bad
 * evening sees their change take hold while they are still watching, and long
 * enough that the checkout path is not paying for it.
 *
 * It is deliberately not zero and deliberately not five minutes. Both are
 * defensible; the first costs a query per order, and the second means a person
 * tightening a threshold cannot tell whether it worked.
 */
const CACHE_TTL_MS = 30_000;

/**
 * The COD thresholds, changeable without a deploy (spec §2.10.4).
 *
 * ## Why not environment variables
 *
 * P2.7 read these from `process.env`, which looks like configuration and is
 * not: on Cloud Run an environment variable lives in the revision, so changing
 * one deploys a new revision. §2.10.4 asks for the opposite, and it asks for a
 * reason — a pilot city tunes these weekly against its own RTO numbers, and a
 * knob that costs a deploy is a knob nobody turns.
 *
 * Environment variables survive as the **seed** for a database that has never
 * been configured, so a fresh environment starts somewhere sensible.
 */
@Injectable()
export class CodConfigService {
  private readonly logger = new Logger(CodConfigService.name);
  private readonly db: Database = createDatabase();

  private cached: { value: CodThresholds; until: number } | null = null;

  /**
   * The thresholds in force right now.
   *
   * Never throws. A database that cannot be read falls back to the defaults,
   * because refusing to score is refusing to take orders — and the failure mode
   * of scoring with slightly stale numbers is much cheaper than the failure
   * mode of a checkout that 500s.
   */
  async current(): Promise<CodThresholds> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.value;

    try {
      const rows = await this.db
        .select()
        .from(codConfig)
        .where(eq(codConfig.key, CONFIG_KEY))
        .limit(1);

      const stored = rows[0]?.thresholds as Partial<CodThresholds> | undefined;

      // Merged over the defaults rather than used raw: a row written before a
      // new threshold existed is missing that key, and `undefined` propagating
      // into a comparison silently makes every order LOW.
      const value = applyPatch(this.seed(), stored ?? {});

      this.cached = { value, until: Date.now() + CACHE_TTL_MS };
      return value;
    } catch (error) {
      this.logger.error(`Could not read COD thresholds: ${String(error)}`);
      return this.seed();
    }
  }

  /**
   * Changes them, attributably.
   *
   * Validated before it is written, because these are edited by hand under
   * pressure and an unreachable band is invisible until the RTO number moves
   * weeks later.
   */
  async update(patch: Partial<CodThresholds>, actorId: string): Promise<CodThresholds> {
    // `applyPatch`, not a spread: under ES2022 class fields every declared DTO
    // property is an own property of the instance whether or not it was sent,
    // so spreading wipes the fields the operator did not touch — which is the
    // exact opposite of what a patch means.
    const next = applyPatch(await this.current(), patch);

    const problems = validateThresholds(next);
    if (problems.length > 0) {
      throw new BadRequestException({
        message: 'These thresholds would not work',
        code: 'INVALID_COD_THRESHOLDS',
        problems,
      });
    }

    await this.db
      .insert(codConfig)
      .values({ key: CONFIG_KEY, thresholds: next, updatedBy: actorId })
      .onConflictDoUpdate({
        target: codConfig.key,
        set: { thresholds: next, updatedBy: actorId, updatedAt: new Date() },
      });

    // This instance sees it immediately; the others within the TTL.
    this.cached = { value: next, until: Date.now() + CACHE_TTL_MS };

    this.logger.log(`COD thresholds changed by ${actorId}`);
    return next;
  }

  /** Drops the cache. For tests, and for an operator who cannot wait 30s. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Where a never-configured environment starts.
   *
   * The environment variables from P2.7 still work, so nothing that was set on
   * a running deployment stops meaning what it meant.
   */
  private seed(): CodThresholds {
    return {
      ...DEFAULT_COD_THRESHOLDS,
      highValuePaise: fromEnv(
        'COD_HIGH_VALUE_PAISE',
        DEFAULT_COD_THRESHOLDS.highValuePaise,
      ),
      veryHighValuePaise: fromEnv(
        'COD_VERY_HIGH_VALUE_PAISE',
        DEFAULT_COD_THRESHOLDS.veryHighValuePaise,
      ),
      rtoBlockCount: fromEnv('COD_RTO_BLOCK_COUNT', DEFAULT_COD_THRESHOLDS.rtoBlockCount),
    };
  }
}

function fromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
