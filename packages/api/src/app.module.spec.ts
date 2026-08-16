import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

loadEnv();

/**
 * Dependency-injection wiring.
 *
 * NestJS resolves constructor dependencies from `emitDecoratorMetadata`, which
 * only emits for *value* imports. Rewriting an injected class to `import type`
 * compiles cleanly, passes lint, and then fails at runtime with "Nest can't
 * resolve dependencies" — exactly the breakage that slipped through in P0.3a
 * when an ESLint autofix rewrote four injected classes.
 *
 * Compiling the real module graph catches it, and needs no database: the
 * connection pool is created lazily, so nothing connects here.
 */
describe('AppModule', () => {
  it('resolves the full dependency graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
