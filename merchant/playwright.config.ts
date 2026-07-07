import { defineConfig } from '@playwright/test';

// E2E for the merchant app. Requires BOTH the merchant (8082) and the PSP
// (backend 8081 + frontend 8080, reseeded DB) to be running — so these are
// typically skipped in CI. Run locally with the full stack up.
const BASE = process.env.PSP_MERCHANT_BASE_URL ?? 'http://localhost:8082';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  reporter: 'list',
});
