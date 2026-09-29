import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Scope Playwright to the e2e directory ONLY. A broader testDir (./test) risks collecting the
  // vitest unit/integration files (test/psp/backend/**, test/psp/frontend/unit/**) — Playwright's matcher
  // also picks up *.test.ts, and importing vitest under Playwright throws. Physically limiting the
  // dir guarantees e2e never loads them, regardless of test-name matching.
  testDir: './test/psp/frontend/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'test/.playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Inherits the top-level testMatch (**/*.spec.ts) scoped to testDir (./test/psp/frontend/e2e).
    },
    // v32 P8: every page the plan touches must be usable at small, medium and large viewports.
    // The responsive specs opt in by name (*.responsive.spec.ts) so the full suite is not run three
    // times; a spec that needs cross-viewport coverage is named accordingly.
    {
      // Tablet width on Chromium rather than the iPad preset, which is WebKit: `npm run setup:tools`
      // installs chromium only, so a WebKit project would fail on a fresh checkout.
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } },
      testMatch: '**/*.responsive.spec.ts',
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/*.responsive.spec.ts',
    },
  ],
  // Auto-start dev server when running locally
  webServer: {
    command: 'npm run dev:frontend',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
