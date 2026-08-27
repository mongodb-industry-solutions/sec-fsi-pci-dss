import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/bank/frontend/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: process.env.BANK_UI_URL ?? 'http://localhost:8084' },
});
