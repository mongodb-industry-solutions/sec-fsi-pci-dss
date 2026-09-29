/**
 * E2E: Admin Panel – Setup Page (/admin/panel/setup)
 *
 * Auth difference vs /system routes:
 *   - /system uses a `demo_token` COOKIE  → injectable via context.addCookies()
 *   - /admin/panel uses `admin_token` in sessionStorage → must inject via
 *     page.addInitScript() BEFORE navigation (the layout's auth guard reads it on mount)
 *
 * Result contract (ADR-026):
 *   POST /api/v1/admin/run returns a text/event-stream body. Test commands emit a
 *   dedicated `summary` frame carrying the normalized TestSummary object directly
 *   (NOT wrapped in {text}); the frontend renders it without parsing log text.
 *   Frame format consumed by readSSE (frontend/src/lib/adminHelpers.ts):
 *     event: <type>\n
 *     data: <json>\n
 *     \n
 *   For log/error/start/done the json is {"text": "..."}; for summary it is the
 *   TestSummary object. The TestSummary panel renders once `done` arrives and a
 *   summary frame was received.
 */
import { test, expect } from '@playwright/test';

const ADMIN_TOKEN = 'fake-admin-token-e2e';

/** Inject admin_token into sessionStorage before the page script runs. */
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.addInitScript((t) => sessionStorage.setItem('admin_token', t), ADMIN_TOKEN);
}

type Frame =
  | { type: 'start' | 'log' | 'error' | 'done'; text: string }
  | { type: 'summary'; summary: Record<string, unknown> };

/** Build a static SSE response body in the exact format readSSE expects. */
function sseBody(frames: Frame[]): string {
  return frames
    .map((f) =>
      f.type === 'summary'
        ? `event: summary\ndata: ${JSON.stringify(f.summary)}\n\n`
        : `event: ${f.type}\ndata: ${JSON.stringify({ text: f.text })}\n\n`,
    )
    .join('');
}

/** Vitest run that passes: logs + a structured summary + done(code 0). */
const SSE_UNIT_PASS = sseBody([
  { type: 'start', text: 'npm run test:unit' },
  { type: 'log',   text: 'RUN  v4.1.0' },
  { type: 'summary', summary: {
    tool: 'vitest', total: 3, passed: 3, failed: 0, skipped: 0, durationMs: 1230, failures: [],
  } },
  { type: 'done',  text: 'Process exited with code 0' },
]);

/** Vitest run that fails: a failure entry with a reason + done(code 1). */
const SSE_UNIT_FAIL = sseBody([
  { type: 'start', text: 'npm run test:unit' },
  { type: 'log',   text: 'RUN  v4.1.0' },
  { type: 'summary', summary: {
    tool: 'vitest', total: 3, passed: 2, failed: 1, skipped: 0, durationMs: 980,
    failures: [{ title: 'test/backend/unit/bar.test.ts > suite > it should work', reason: 'AssertionError: expected 1 to equal 2' }],
  } },
  { type: 'done',  text: 'Process exited with code 1' },
]);

/** Playwright run that passes, to assert the tool badge reflects the strategy. */
const SSE_E2E_PASS = sseBody([
  { type: 'start', text: 'npm run test:e2e' },
  { type: 'summary', summary: {
    tool: 'playwright', total: 5, passed: 5, failed: 0, skipped: 0, durationMs: 8400, failures: [],
  } },
  { type: 'done',  text: 'Process exited with code 0' },
]);

/** All Tests aggregate: combined summary across suites + done(code 1 because one failed). */
const SSE_ALL_TESTS = sseBody([
  { type: 'start', text: 'npm run test:unit' },
  { type: 'log',   text: 'RUN  v4.1.0' },
  { type: 'summary', summary: {
    tool: 'all', total: 13, passed: 12, failed: 1, skipped: 2, durationMs: 10600,
    failures: [{ title: 'test/backend/unit/bar.test.ts > suite > it should work', reason: 'AssertionError: expected 1 to equal 2' }],
  } },
  { type: 'done',  text: 'Process exited with code 1' },
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
    // Fresh page: addInitScript from beforeEach does NOT apply to pages opened later
    const guest = await context.newPage();
    await guest.goto('/admin/panel/setup');
    await expect(guest).toHaveURL(/\/admin$/, { timeout: 6_000 });
    await guest.close();
  });

  // ── Test commands → TestSummary from the structured summary event ─────────────

  test('Unit Tests: passing run shows TestSummary with "All passed" and vitest badge', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_UNIT_PASS }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=All passed').first()).toBeVisible();
    // Tool badge comes straight from summary.tool
    await expect(page.locator('text=vitest').first()).toBeVisible();
  });

  test('Unit Tests: failing run shows failure count, title and reason', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_UNIT_FAIL }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("Unit Tests")').first().click();

    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=/1 failed/').first()).toBeVisible();
    await expect(page.locator('text=/bar.test.ts/').first()).toBeVisible();
    await expect(page.locator('text=/AssertionError/').first()).toBeVisible();
  });

  test('E2E Tests: summary reflects the playwright tool badge', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_E2E_PASS }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("E2E Tests")').first().click();

    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=playwright').first()).toBeVisible();
  });

  test('All Tests: aggregate run shows a combined TestSummary with "all suites" badge', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_ALL_TESTS }),
    );

    await page.goto('/admin/panel/setup');
    await page.locator('button:has-text("All Tests")').first().click();

    await expect(page.locator('text=Test Results').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=all suites').first()).toBeVisible();
    await expect(page.locator('text=/1 failed/').first()).toBeVisible();
    await expect(page.locator('text=/bar.test.ts/').first()).toBeVisible();
  });

  // ── Non-test commands → NO summary event → NO TestSummary panel ──────────────

  test('Setup command does NOT render TestSummary (no summary event emitted)', async ({ page }) => {
    await page.route('**/api/v1/admin/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          { type: 'start', text: 'npm run setup:check' },
          { type: 'log',   text: 'All checks passed' },
          { type: 'done',  text: 'Process exited with code 0' },
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
