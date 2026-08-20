import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { CodFlowService } from '../modules/order/contracts';

loadEnv();

/**
 * Closes cash orders nobody confirmed (spec §2.10.4).
 *
 * The confirmation window is the whole mechanism: without something to close
 * it, a customer who ignores the message leaves an order holding stock and a
 * delivery slot indefinitely — capacity that customers who *would* confirm
 * cannot have, and a shop that never hears about either.
 *
 * Fourth tenant of the job runner built in P2.5a. A Cloud Run job rather than a
 * timer for the reason established there: the service scales to zero, so an
 * in-process timer may never fire, and with several instances it fires several
 * times.
 */
export async function runCodConfirmationSweep(): Promise<{
  considered: number;
  cancelled: number;
  failed: number;
}> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    return await context.get(CodFlowService).expireOverdue();
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/cod-confirmation-sweep.js`. */
async function main(): Promise<void> {
  const logger = new Logger('CodConfirmationSweep');
  const result = await runCodConfirmationSweep();

  logger.log(
    `checked ${result.considered} overdue confirmation(s): ` +
      `${result.cancelled} cancelled, ${result.failed} failed`,
  );

  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('COD confirmation sweep failed:', error);
    process.exitCode = 1;
  });
}
