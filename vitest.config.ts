import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Use jsdom for frontend tests, node for backend tests
    environmentMatchGlobs: [
      ['test/frontend/**', 'jsdom'],
      ['test/backend/**', 'node'],
    ],
    include: [
      'test/frontend/unit/**/*.test.{ts,tsx}',
      'test/frontend/integration/**/*.test.{ts,tsx}',
      'test/backend/unit/**/*.test.ts',
      'test/backend/integration/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['frontend/src/**', 'backend/src/**'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
  },
});
