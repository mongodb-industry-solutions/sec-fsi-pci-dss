import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // v37: run the shared package from source, so a test never sees a stale dist build.
    alias: {
      '@leafypay/eventbus': resolve(__dirname, 'packages/eventbus/src/index.ts'),
      '@leafypay/platform-links': resolve(__dirname, 'packages/platform-links/src/index.ts'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // v32: integration suites build the QE clients in beforeAll (crypt_shared load, DEK
    // provisioning, Atlas connection), which does not fit the 10s default on a cold start.
    hookTimeout: 60000,
    testTimeout: 30000,
    // Use jsdom for frontend tests, node for backend tests
    environmentMatchGlobs: [
      ['test/psp/frontend/**', 'jsdom'],
      ['test/psp/backend/**', 'node'],
      // v37: bankcore is a second Fastify service, so its suites run in node like the backend's.
      ['test/bank/backend/**', 'node'],
    ],
    include: [
      'test/psp/frontend/unit/**/*.test.{ts,tsx}',
      'test/psp/frontend/integration/**/*.test.{ts,tsx}',
      'test/psp/backend/unit/**/*.test.ts',
      'test/psp/backend/integration/**/*.test.ts',
      'test/bank/backend/unit/**/*.test.ts',
      'test/bank/backend/integration/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['psp/frontend/src/**', 'psp/backend/src/**', 'bank/backend/src/**'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
  },
});
