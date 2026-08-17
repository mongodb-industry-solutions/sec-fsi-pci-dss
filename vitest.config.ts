import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // v37: run the shared package from source, so a test never sees a stale dist build.
    alias: { '@leafypay/eventbus': resolve(__dirname, 'packages/eventbus/src/index.ts') },
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
      ['test/frontend/**', 'jsdom'],
      ['test/backend/**', 'node'],
      // v37: bankcore is a second Fastify service, so its suites run in node like the backend's.
      ['test/bankcore/**', 'node'],
    ],
    include: [
      'test/frontend/unit/**/*.test.{ts,tsx}',
      'test/frontend/integration/**/*.test.{ts,tsx}',
      'test/backend/unit/**/*.test.ts',
      'test/backend/integration/**/*.test.ts',
      'test/bankcore/unit/**/*.test.ts',
      'test/bankcore/integration/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['frontend/src/**', 'backend/src/**', 'bankcore/src/**'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
  },
});
