import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads `.env` from the repository root.
 *
 * The file lives at the monorepo root but scripts run with their working
 * directory set to `packages/api`, and compiled output sits under `dist/`, so
 * neither `process.cwd()` nor a fixed relative path is reliable. Walk up
 * instead.
 *
 * Real environments (staging, production) inject variables directly; a missing
 * .env is therefore not an error.
 */
export function loadEnv(startDir: string = __dirname): void {
  const root = parse(startDir).root;
  let dir = startDir;

  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    if (dir === root) return;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
