import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { VendorOrderFlowService } from '../modules/order/contracts';

loadEnv();

/**
 * Chases stores that have not answered a new order (spec §1.9.4).
 *
 * ## Why a job and not a timer
 *
 * An in-process schedule is wrong on Cloud Run in both directions: the service
 * scales to zero, so a timer may never fire at all, and when several revisions
 * are up it fires several times. A job runs exactly when Cloud Scheduler says
 * so, on its own instance, whatever the API is doing.
 *
 * ## Why a job and not an HTTP endpoint
 *
 * `POST /internal/vendor-sla/sweep` still exists for an operator who wants to
 * force a pass. But a *scheduled* trigger over HTTP would mean the API carries
 * a second authentication path — Cloud Scheduler presents a Google identity
 * token, not one of ours — and after P8.6 makes the API public that path is
 * internet-reachable. The job has no HTTP surface to protect.
 *
 * Reservation expiry (P3.1) needs the same shape and should live beside this.
 */
export async function runSlaSweep(): Promise<{
  considered: number;
  reminded: number;
  breached: number;
  failed: number;
}> {
  // No HTTP server: this needs the dependency graph, not a listener.
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const flow = context.get(VendorOrderFlowService);
    return await flow.sweepAcceptanceSla();
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/sla-sweep.js`. */
async function main(): Promise<void> {
  const logger = new Logger('SlaSweep');
  const result = await runSlaSweep();

  logger.log(
    `swept ${result.considered} waiting order(s): ` +
      `${result.reminded} reminded, ${result.breached} cancelled, ${result.failed} failed`,
  );

  // A sweep that could not process some orders exits non-zero so the failure is
  // visible as a failed execution rather than buried in a log line nobody reads.
  if (result.failed > 0) process.exitCode = 1;
}

// Only when executed directly, so importing this for a test does not run it.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('SLA sweep failed:', error);
    process.exitCode = 1;
  });
}
