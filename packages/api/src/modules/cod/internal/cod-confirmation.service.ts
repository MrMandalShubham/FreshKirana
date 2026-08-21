import { Injectable, Logger } from '@nestjs/common';
import {
  COD_OTP_LENGTH,
  COD_OTP_MAX_ATTEMPTS,
  CodConfirmationMethod,
  CodConfirmationStatus,
  type CodRiskBand,
  type CodThresholds,
  type RiskAssessment,
  type RiskInput,
} from '@freshkirana/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { type Database, createDatabase } from '../../../db';
import { codConfirmation, codRiskDecision } from '../schema';

export interface OpenedConfirmation {
  id: string;
  method: CodConfirmationMethod;
  expiresAt: Date;
  /**
   * The plaintext code, returned **once** and never stored.
   *
   * The caller sends it and forgets it. Nothing can read it back afterwards,
   * which is the point — a support person reading a live code out of a table is
   * the beginning of a story that ends badly.
   */
  otp?: string;
}

export type VerifyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'NO_CONFIRMATION'
        | 'NOT_PENDING'
        | 'EXPIRED'
        | 'TOO_MANY_ATTEMPTS'
        | 'WRONG_CODE';
      attemptsLeft?: number;
    };

/**
 * The confirmation ceremony, and the audit trail under it (spec §2.10.4).
 *
 * Knows about codes, windows and records. Knows nothing about orders beyond an
 * id — moving an order is the order module's job, and a cod module that could
 * transition orders would be a second place where fulfilment state changes.
 */
@Injectable()
export class CodConfirmationService {
  private readonly logger = new Logger(CodConfirmationService.name);
  private readonly db: Database = createDatabase();

  /**
   * Writes the decision down (§2.10.4, §3.8).
   *
   * Every COD order, not only the refused ones. A log of refusals answers "why
   * was I blocked?" but not "are these thresholds right?", and the second
   * question decides whether COD is profitable at all.
   */
  async recordDecision(input: {
    orderId: string | null;
    accountId: string;
    assessment: RiskAssessment;
    thresholds: CodThresholds;
    inputs: RiskInput;
    confirmationMethod: CodConfirmationMethod;
  }): Promise<string> {
    const rows = await this.db
      .insert(codRiskDecision)
      .values({
        orderId: input.orderId,
        accountId: input.accountId,
        band: input.assessment.band,
        score: input.assessment.score,
        reasons: input.assessment.reasons,
        // Snapshotted, not referenced: thresholds change without a deploy, so a
        // decision read six weeks later cannot be explained by today's config.
        thresholds: input.thresholds,
        inputs: input.inputs,
        confirmationMethod: input.confirmationMethod,
      })
      .returning({ id: codRiskDecision.id });

    return rows[0]!.id;
  }

  /** Every decision made about one account, newest first. */
  async decisionsFor(accountId: string, limit = 50) {
    return this.db
      .select()
      .from(codRiskDecision)
      .where(eq(codRiskDecision.accountId, accountId))
      .orderBy(codRiskDecision.createdAt)
      .limit(limit);
  }

  async decisionForOrder(orderId: string) {
    const rows = await this.db
      .select()
      .from(codRiskDecision)
      .where(eq(codRiskDecision.orderId, orderId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Starts the ceremony.
   *
   * Idempotent on the order: a retried placement must not mint a second code,
   * because two live codes means the customer reads the wrong one and the
   * confirmation that should have saved the order kills it instead.
   */
  async open(input: {
    orderId: string;
    accountId: string;
    method: CodConfirmationMethod;
    windowMinutes: number;
  }): Promise<OpenedConfirmation> {
    const existing = await this.forOrder(input.orderId);
    if (existing && existing.status === CodConfirmationStatus.PENDING) {
      return {
        id: existing.id,
        method: existing.method as CodConfirmationMethod,
        expiresAt: existing.expiresAt,
      };
    }

    const otp = input.method === CodConfirmationMethod.OTP ? newOtp() : undefined;

    const expiresAt = new Date(Date.now() + input.windowMinutes * 60_000);

    const rows = await this.db
      .insert(codConfirmation)
      .values({
        orderId: input.orderId,
        accountId: input.accountId,
        method: input.method,
        status: CodConfirmationStatus.PENDING,
        otpHash: otp ? hash(otp) : null,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: codConfirmation.orderId,
        set: {
          method: input.method,
          status: CodConfirmationStatus.PENDING,
          otpHash: otp ? hash(otp) : null,
          attempts: 0,
          expiresAt,
          resolvedAt: null,
          resolvedBy: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const created = rows[0]!;

    return {
      id: created.id,
      method: input.method,
      expiresAt,
      ...(otp ? { otp } : {}),
    };
  }

  async forOrder(orderId: string) {
    const rows = await this.db
      .select()
      .from(codConfirmation)
      .where(eq(codConfirmation.orderId, orderId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Checks a code the customer typed back.
   *
   * Compared in constant time and counted, so a wrong code costs an attempt
   * rather than nothing. Five attempts is enough to survive fat fingers on a
   * six-digit code and few enough that guessing is not a strategy.
   */
  async verifyOtp(orderId: string, code: string): Promise<VerifyOutcome> {
    const found = await this.forOrder(orderId);

    if (!found) return { ok: false, reason: 'NO_CONFIRMATION' };
    if (found.status !== CodConfirmationStatus.PENDING) {
      return { ok: false, reason: 'NOT_PENDING' };
    }
    if (found.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    if (found.attempts >= COD_OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    }

    // Counted before it is checked. Counting afterwards means a crash between
    // the two gives a free guess, and a loop that crashes is a loop with
    // unlimited guesses.
    const attempts = found.attempts + 1;
    await this.db
      .update(codConfirmation)
      .set({ attempts, updatedAt: new Date() })
      .where(eq(codConfirmation.id, found.id));

    if (!found.otpHash || !matches(found.otpHash, code)) {
      return {
        ok: false,
        reason: 'WRONG_CODE',
        attemptsLeft: Math.max(0, COD_OTP_MAX_ATTEMPTS - attempts),
      };
    }

    return { ok: true };
  }

  /**
   * Closes the ceremony.
   *
   * Guarded on still being PENDING, so a customer tapping "yes" as the sweeper
   * expires the order cannot produce a confirmation on a cancelled order —
   * whichever lands first wins, and the other is a no-op rather than a
   * contradiction.
   */
  async resolve(
    orderId: string,
    status: CodConfirmationStatus,
    resolvedBy?: string,
    note?: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(codConfirmation)
      .set({
        status,
        resolvedAt: new Date(),
        resolvedBy: resolvedBy ?? null,
        resolutionNote: note ?? null,
        // The code dies with the ceremony.
        otpHash: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(codConfirmation.orderId, orderId),
          eq(codConfirmation.status, CodConfirmationStatus.PENDING),
        ),
      )
      .returning({ id: codConfirmation.id });

    return rows.length > 0;
  }

  /** Ceremonies nobody answered. Their orders are still holding stock. */
  async overdue(limit = 200) {
    return (
      this.db
        .select()
        .from(codConfirmation)
        .where(
          and(
            eq(codConfirmation.status, CodConfirmationStatus.PENDING),
            sql`${codConfirmation.expiresAt} < now()`,
          ),
        )
        // Oldest first, and ordered at all: an unordered `LIMIT` returns an
        // arbitrary slice, so a backlog larger than the limit can starve the
        // same rows forever — and these are people waiting.
        .orderBy(asc(codConfirmation.expiresAt))
        .limit(limit)
    );
  }
}

/**
 * A six-digit code.
 *
 * `randomInt` rather than `Math.random`: this is a credential, however modest,
 * and a predictable one is worse than none because it looks like a control.
 * Padded so every code is six characters — a code shown as "42" is a code the
 * customer thinks is broken.
 */
function newOtp(): string {
  const max = 10 ** COD_OTP_LENGTH;
  return String(randomInt(0, max)).padStart(COD_OTP_LENGTH, '0');
}

function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function matches(storedHash: string, code: string): boolean {
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hash(code), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Re-exported so callers do not reach past `contracts` for a band type. */
export type { CodRiskBand };
