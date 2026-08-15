import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated as reviewable SQL files and committed (spec §2.3).
 * They must be backward-compatible for one release — expand/contract (§2.15).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/platform.schema.ts', './src/modules/*/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://freshkirana:freshkirana_local@localhost:5432/freshkirana',
  },
  verbose: true,
  strict: true,
});
