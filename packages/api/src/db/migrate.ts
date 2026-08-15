import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env';
import { closeDatabase, createDatabase } from './index';

loadEnv();

/**
 * Applies pending migrations. Run via `npm run db:migrate`.
 *
 * Deploys run this before the new application version starts, which is why
 * migrations must be backward-compatible for one release (§2.15).
 */
async function main(): Promise<void> {
  const db = createDatabase();
  await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  console.warn('migrations applied');
  await closeDatabase();
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exitCode = 1;
  void closeDatabase();
});
