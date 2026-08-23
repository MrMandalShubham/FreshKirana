import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { BatchService } from '../modules/offer/contracts';

loadEnv();

/**
 * Delists stock too short-dated to deliver (spec §1.7.3).
 *
 * Shelf life passes with the clock rather than with anything a person does. A
 * batch that was fine last night is not fine this morning, and nobody logs in
 * to notice — so without this, the first person to find out is a customer
 * opening a bag of paneer that expires today.
 *
 * Sixth tenant of the job runner built in P2.5a.
 */
export async function runShelfLifeSweep(): Promise<{
  considered: number;
  delisted: number;
  offersClosed: number;
}> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    return await context.get(BatchService).delistShortDated();
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/shelf-life-sweep.js`. */
async function main(): Promise<void> {
  const logger = new Logger('ShelfLifeSweep');
  const result = await runShelfLifeSweep();

  logger.log(
    `checked ${result.considered} batch(es): ${result.delisted} delisted, ` +
      `${result.offersClosed} offer(s) closed`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Shelf life sweep failed:', error);
    process.exitCode = 1;
  });
}
