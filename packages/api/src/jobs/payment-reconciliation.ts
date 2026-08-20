import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { loadEnv } from '../config/env';
import { PaymentFlowService } from '../modules/order/contracts';

loadEnv();

/**
 * Finds payments the webhook never told us about (spec §2.10.3, §2.11.3).
 *
 * Webhooks are lost — a deploy restarts an instance mid-request, a network
 * blips, a gateway has an incident. The result is an order sitting in
 * PENDING_PAYMENT while the customer's money is already gone, and nothing about
 * it looks like an error from the inside. That is the worst failure this system
 * has, and it is silent, so something has to go and ask.
 *
 * Third tenant of the job runner built in P2.5a.
 */
export async function runPaymentReconciliation(): Promise<{
  considered: number;
  recovered: number;
  cancelled: number;
  failed: number;
}> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    return await context.get(PaymentFlowService).reconcilePending();
  } finally {
    await context.close();
  }
}

/** Entry point. `node packages/api/dist/jobs/payment-reconciliation.js`. */
async function main(): Promise<void> {
  const logger = new Logger('PaymentReconciliation');
  const result = await runPaymentReconciliation();

  logger.log(
    `checked ${result.considered} pending payment(s): ` +
      `${result.recovered} recovered, ${result.cancelled} cancelled as unpaid, ` +
      `${result.failed} failed`,
  );

  // A recovery is not an error, but it *is* a webhook that did not arrive.
  // Logged at warn by the flow service so it shows up without failing the job.
  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Payment reconciliation failed:', error);
    process.exitCode = 1;
  });
}
