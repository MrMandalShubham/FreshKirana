import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { SubstitutionService } from '../modules/order/contracts';

loadEnv();

/**
 * Closes substitution questions nobody answered (spec §1.7.2).
 *
 * The ten-minute window is the whole mechanism. Without something to close it,
 * a customer who misses the message leaves a picker standing in an aisle with a
 * half-filled crate and an order that cannot move — and §1.7.2's fallback, a
 * refund, is the answer that cannot be wrong but never arrives on its own.
 *
 * Fifth tenant of the job runner built in P2.5a.
 */
export async function runSubstitutionSweep(): Promise<{
  considered: number;
  refunded: number;
  failed: number;
}> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const result = await context.get(SubstitutionService).expireOverdue();
    return {
      considered: result.considered,
      refunded: result.refunded,
      failed: result.failed,
    };
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/substitution-sweep.js`. */
async function main(): Promise<void> {
  const logger = new Logger('SubstitutionSweep');
  const result = await runSubstitutionSweep();

  logger.log(
    `checked ${result.considered} unanswered substitution(s): ` +
      `${result.refunded} refunded, ${result.failed} failed`,
  );

  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Substitution sweep failed:', error);
    process.exitCode = 1;
  });
}
