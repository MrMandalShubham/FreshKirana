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
  pool ??= new Pool({
    connectionString,
    // Sized for a single API instance; §1.4.1 peak is ~150 RPS across 2-3
    // instances, well inside Postgres' default 100 connection limit.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export function createDatabase(connectionString?: string): Database {
  return drizzle(getPool(connectionString), { schema });
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env (see README).');
  }
  return url;
}

export * from './platform.schema';
