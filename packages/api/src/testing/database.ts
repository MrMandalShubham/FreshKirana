import { closeDatabase, createDatabase } from '../db';

/**
 * Whether the e2e suites in this file should run.
 *
 * ## Why this is not just a try/catch
 *
 * Every e2e file used to carry its own copy of this check, and every copy
 * swallowed *all* failures into "skip". That is the wrong default twice over:
 *
 * - A suite that skips reads as green. Twice during this build a dependency
 *   injection error — the application graph literally could not be
 *   constructed — was reported as "21 skipped" and very nearly shipped.
 * - A database that is configured but unreachable is a broken environment, not
 *   an absent one. Skipping hides exactly the failure worth knowing about.
 *
 * So: **no `DATABASE_URL` is a skip** (a fresh clone, someone reading the code)
 * and **anything else is a failure**. The message says which, because "cannot
 * connect" and "table does not exist" want different fixes.
 */
export async function requireDatabase(probeTable: string): Promise<boolean> {
  if (!process.env['DATABASE_URL']) {
    console.warn(
      `\n  e2e SKIPPED — no DATABASE_URL.\n` +
        `  Start the Cloud SQL proxy and copy .env.example to .env (see README).\n`,
    );
    return false;
  }

  try {
    const db = createDatabase();
    await db.execute(`select 1 from ${probeTable} limit 1`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(
      `DATABASE_URL is set but ${probeTable} could not be read: ${reason}\n` +
        `If the schema is missing, run: npm run build && npm run db:migrate\n` +
        `If the connection is refused, the Cloud SQL proxy is not running.`,
    );
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}
