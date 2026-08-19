import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { requireDatabase } from '../testing/database';
import { runSlaSweep } from './sla-sweep';

loadEnv();

const dbUp = await requireDatabase('"order"."order"');

/**
 * The job entrypoint, run exactly as Cloud Scheduler runs it.
 *
 * This is a thin file, and thin files are where deployment breaks: a wrong
 * `args` path, a provider that is not exported, a module the application
 * context cannot construct. None of that shows up in a unit test of the
 * service, and all of it shows up here — before it shows up as a job failing
 * silently every two minutes in production.
 */
describe.skipIf(!dbUp)('SLA sweep job (e2e)', () => {
  it('boots the application graph and completes a pass', async () => {
    const result = await runSlaSweep();

    expect(result).toMatchObject({
      considered: expect.any(Number),
      reminded: expect.any(Number),
      breached: expect.any(Number),
      failed: expect.any(Number),
    });
  }, 120_000);

  it('runs again after a previous pass shut everything down', async () => {
    // Cloud Scheduler fires this every two minutes, each time in a fresh
    // process — but a second pass inside one process is the sharper test: it
    // only passes if tearing down the first context left the module able to
    // build a new connection pool rather than a closed one.
    const first = await runSlaSweep();
    const second = await runSlaSweep();

    expect(first.failed).toBe(0);
    expect(second.failed).toBe(0);
  }, 180_000);
});
