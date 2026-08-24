import { loadEnv } from '../config/env';

/**
 * Loads `.env` once, before any spec runs.
 *
 * Without this, the only call to `loadEnv` was in `app.module.spec.ts`, so
 * every e2e suite depended on that file happening to run first in the same
 * worker. Run one e2e file on its own — `vitest run path/to/one.e2e.spec.ts` —
 * and `DATABASE_URL` was unset, so `requireDatabase` skipped and the suite
 * reported green while testing nothing.
 *
 * That is the exact failure `requireDatabase` was written to prevent, arriving
 * through the back door.
 */
loadEnv();
