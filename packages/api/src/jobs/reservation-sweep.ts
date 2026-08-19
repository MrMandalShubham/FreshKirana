import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { InventoryService } from '../modules/inventory/contracts';

loadEnv();

/**
 * Releases stock held by checkouts nobody finished (spec §2.5).
 *
 * Abandoned checkouts are the normal case, not an exception: somebody opens
 * their bank's app to pay and never comes back. Every one of them is holding
 * stock that no other customer can buy, and on a shelf of three packets that is
 * the difference between selling out and looking sold out.
 *
 * §2.5 asks for this every 60 seconds. A Cloud Run job for the same reasons as
 * the SLA sweep (P2.5a): the API scales to zero so an in-process timer may
 * never fire, and with several instances up it fires several times.
 */
export async function runReservationSweep(): Promise<{
  considered: number;
  released: number;
  failed: number;
}> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    return await context.get(InventoryService).sweepExpired();
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/reservation-sweep.js`. */
async function main(): Promise<void> {
  const logger = new Logger('ReservationSweep');
  const result = await runReservationSweep();

  logger.log(
    `swept ${result.considered} expired hold(s): ` +
      `${result.released} released, ${result.failed} failed`,
  );

  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Reservation sweep failed:', error);
    process.exitCode = 1;
  });
}
