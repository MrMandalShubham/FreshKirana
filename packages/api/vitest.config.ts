import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS relies on `emitDecoratorMetadata`, which esbuild (Vitest's default
// transformer) does not support. SWC does, so it handles transformation here.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: './',

    /**
     * One test file at a time.
     *
     * Every e2e file boots the whole application against the *same* Cloud SQL
     * database, and each boot opens a pool of up to 10 connections. Running a
     * dozen files at once asks for more connections than the instance allows,
     * and the symptom is a five-second connect timeout in whichever file loses
     * — a failure that looks like a flake and is not.
     *
     * It also removes a class of cross-file interference on shared data, which
     * has cost more debugging time in this build than the extra runtime does.
     */
    fileParallelism: false,

    // Booting a Nest application and seeding fixtures over a network round trip
    // does not fit in the 10s default.
    hookTimeout: 120_000,
    // Each e2e test makes several HTTP round trips, each several queries, against
    // Cloud SQL through the auth proxy. 30s was tight enough that ordinary
    // latency read as a failure.
    testTimeout: 60_000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
