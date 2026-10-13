import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC, not esbuild: Nest's DI needs emitted decorator metadata (.swcrc).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
          exclude: ['test/e2e/**', 'node_modules/**'],
          globalSetup: ['test/support/compile-app.global-setup.ts'],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.spec.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
