/**
 * E2E: Admin Panel – Setup Page (/admin/panel/setup)
 *
 * Auth difference vs /system routes:
 *   - /system uses a `demo_token` COOKIE  → injectable via context.addCookies()
 *   - /admin/panel uses `admin_token` in sessionStorage → must inject via
 *     page.addInitScript() BEFORE navigation (sessionStorage is wiped on nav otherwise)
 *
 * SSE stub:
 *   POST /api/v1/admin/run returns a text/event-stream body.
 *   readSSE() splits on "\n\n" and parses each frame.
 *   route.fulfill({ body: sseBody(...) }) sends the full body at once, which
 *   the reader processes as a single chunk — works correctly because the reader
 *   returns done:true on the next read, ending the loop.
 *
 * TestSummary only appears when:
 *   1. lastCommand is in TEST_COMMANDS (test | test:unit | test:integration | test:e2e)
 *   2. running === false (stream finished)
 *   3. commandStatus is non-null (set from the "done" event text)
 */
import { test, expect } from '@playwright/test';

const ADMIN_TOKEN = 'fake-admin-token-e2e';

/** Inject admin_token into sessionStorage before the page script runs. */
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.addInitScript((t) => sessionStorage.setItem('admin_token', t), ADMIN_TOKEN);
}

/**
 * Build a static SSE response body.
 * Each entry becomes: `event: <type>\ndata: {"text":"<text>"}\n\n`
 * readSSE() expects this exact format (see frontend/src/lib/adminHelpers.ts).
 */
function sseBody(entries: Array<{ type: string; text: string }>): string {
  return entries
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify({ text: e.text })}\n\n`)
    .join('');
}

/** Passing vitest-style output — matches parseTestResults() patterns. */
const SSE_UNIT_PASS = sseBody([
  { type: 'start', text: 'npm run test:unit' },
  { type: 'log',   text: ' PASS  test/unit/foo.test.ts' },
  { type: 'log',   text: 'Test Files  1 passed (1)' },
  { type: 'log',   text: 'Tests  3 passed (3)' },
  { type: 'log',   text: 'Duration  1.23s' },
  { type: 'done',  text: 'Command exited with code 0' },
]);

/** Failing vitest-style output — parseTestResults() extracts failure list. */
const SSE_UNIT_FAIL = sseBody([
  { type: 'start', text: 'npm run test:unit' },
  { type: 'log',   text: ' FAIL  test/unit/bar.test.ts > suite > it should work' },
  { type: 'log',   text: 'AssertionError: expected 1 to equal 2' },
  { type: 'log',   text: 'Test Files  1 failed | 0 passed (1)' },
  { type: 'log',   text: 'Tests  1 failed | 2 passed (3)' },
  { type: 'log',   text: 'Duration  0.98s' },
  { type: 'done',  text: 'Command exited with code 1' },
]);

test.describe('Admin Panel: Setup Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // ── Guard & render ───────────────────────────────────────────────────────────

  test('renders command groups when admin token is present', async ({ page }) => {
    await page.goto('/admin/panel/setup');
    await expect(page.locator('text=Full Setup').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=Unit Tests').first()).toBeVisible();
    await expect(page.locator('text=E2E Tests').first()).toBeVisible();
    await expect(page.locator('text=Validate Setup').first()).toBeVisible();
  });

  test('without admin token redirects to /admin', async ({ context }) => {
    // Fresh page — addInitScript from beforeEach does NOT apply to pages opened later
    const guest = await context.newPage();
    await guest.goto('/admin/panel/setup');
    await expect(guest).toHaveURL(/\/admin$/, { timeout: 6_000 });
    await guest.close();
  });

  // ── Test commands → TestSummary ──────────────────────────────────────────────

  test('Unit Tests: passing run shows TestSummary with "All passed"', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_UNIT_PASS }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    // TestSummary is only rendered once the stream ends and commandStatus is set
    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=All passed').first()).toBeVisible();
    // Log panel shows the raw vitest output
    await expect(page.locator('text=PASS').first()).toBeVisible();
  });

  test('Unit Tests: failing run shows failure count and failure entry', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_UNIT_FAIL }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    // Status badge shows "N failed"
    await expect(page.locator('text=/\\d+ failed/').first()).toBeVisible();
    // Failure list entry includes the test file name
    await expect(page.locator('text=/bar.test.ts/').first()).toBeVisible();
  });

  test('Unit Tests: failure reason (AssertionError) appears under the failure title', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_UNIT_FAIL }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    await expect(page.locator('text=/AssertionError/').first()).toBeVisible({ timeout: 8_000 });
  });

  // ── Non-test commands → NO TestSummary ──────────────────────────────────────

  test('Setup command does NOT render TestSummary (not a TEST_COMMANDS entry)', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          { type: 'start', text: 'npm run setup:check' },
          { type: 'log',   text: 'All checks passed' },
          { type: 'done',  text: 'Command exited with code 0' },
        ]),
      }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Validate Setup")').first().click();

    await expect(page.locator('text=All checks passed').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=Test Results')).not.toBeVisible();
  });

  // ── API error path ───────────────────────────────────────────────────────────

  test('API error on run shows error line in log panel', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    // When res.ok is false the page sets logs to [{type:'error', text: ...}]
    await expect(page.locator('text=/error/i').first()).toBeVisible({ timeout: 6_000 });
  });
});
