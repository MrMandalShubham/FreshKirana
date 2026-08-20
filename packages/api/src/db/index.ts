import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as platformSchema from './platform.schema';

export const schema = { ...platformSchema };

export type Database = NodePgDatabase<typeof schema>;

/**
 * A database handle inside `db.transaction(...)`.
 *
 * Services that participate in someone else's transaction take
 * `Transaction | Database`, so the same method works standalone and as one step
 * of an atomic sequence. Checkout needs exactly this: the slot booking, the
 * order and the cart's conversion either all happen or none do.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let pool: Pool | undefined;

export function getPool(connectionString = requireDatabaseUrl()): Pool {
  if (pool) return pool;

  const created = new Pool({
    connectionString,
    // Sized for a single API instance; §1.4.1 peak is ~150 RPS across 2-3
    // instances, well inside Postgres' default 100 connection limit.
    max: 10,
    idleTimeoutMillis: 30_000,

    /**
     * How long to wait for a connection before giving up.
     *
     * Ten seconds in production, where a database that slow is a problem worth
     * failing fast on — a request queued behind a sick pool is a request the
     * customer has already given up on.
     *
     * Longer under Vitest, because the test path is not the production path:
     * every connection crosses the public internet to Mumbai through the Cloud
     * SQL Auth Proxy, and establishing one occasionally takes longer than ten
     * seconds on an ordinary home connection. That is latency, not sickness —
     * `max_connections` on the instance is 100 and fewer than ten are ever in
     * use — and failing a fifteen-minute gate over it teaches nothing.
     */
    connectionTimeoutMillis: process.env['VITEST'] ? 30_000 : 10_000,

    /**
     * Keep idle connections alive at the TCP level.
     *
     * Every connection runs through the Cloud SQL Auth Proxy, and proxies and
     * NAT layers drop idle TCP without telling either end. The application then
     * checks out a client that looks fine, issues a query, and gets
     * "Connection terminated unexpectedly" — surfacing as a 500 on a request
     * that did nothing wrong. Keepalives make the drop visible to the pool,
     * which then discards the connection instead of handing it out.
     */
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  /**
   * An idle client that errors emits on the pool, not on any request.
   *
   * Without this listener Node treats it as an unhandled `error` event and
   * takes the process down — losing every in-flight request because one idle
   * connection was dropped. The pool has already discarded the client by the
   * time this runs; there is nothing to do but say so.
   */
  created.on('error', (error) => {
    console.error(`[db] idle client error: ${error.message}`);
  });

  pool = created;
  return pool;
}

export function createDatabase(connectionString?: string): Database {
  return drizzle(getPool(connectionString), { schema });
}

/**
 * Closes the pool. Safe to call twice, and safe to call twice at once.
 *
 * The module variable is cleared *before* the await, so a second caller finds
 * nothing to close rather than calling `end()` on a pool that is already
 * closing — which throws "Called end on pool more than once". Shutdown paths
 * genuinely do run twice: a SIGTERM handler and an application close, or two
 * test contexts tearing down together.
 */
export async function closeDatabase(): Promise<void> {
  const closing = pool;
  pool = undefined;
  await closing?.end();
}

export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (see README).');
  }
  return url;
}

export * from './platform.schema';
