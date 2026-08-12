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
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
