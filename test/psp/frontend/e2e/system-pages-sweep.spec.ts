/**
 * v37 P11.5: every /system page loads and shows data, against the REAL services.
 *
 * Deliberately unmocked. The rest of the e2e suite stubs the API so it can assert a specific rendering
 * without a database; this one exists to catch the opposite failure: a page that renders perfectly against a
 * stub and is blank against the extracted system, because the capability behind it now resolves to the bank.
 * A stub would hide exactly the regression this phase is looking for.
 *
 * Requires the PSP, the bank, the frontend AND the authority running, the last of these since v39 moved
 * sign-in out: a page is reached by signing in for real, through the redirect, because that is now the only
 * way to hold a session. It fails rather than skips when they are not up, because a compatibility pass that
 * silently passes on a dead environment is worse than no pass.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';
import { signIn } from './_signIn';

const PSP = process.env.PSP_API_URL ?? 'http://localhost:8081';

/**
 * The signed-in session, established ONCE and replayed into each test's fresh context.
 *
 * Sign-in is now an interactive redirect through the authority, so doing it per test would mean one
 * real browser login for every page in the sweep. Held as cookies in a variable rather than through
 * `test.use({ storageState })`, which reads its file when the context is built and so cannot be
 * given a file that a `beforeAll` in the same suite is what creates.
 */
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

// Derived from the filesystem rather than hand-listed, so a page added later is swept without anyone
// remembering to add it here. Dynamic segments are excluded: sweeping `[id]` with an invented id would assert
// a not-found page and prove nothing, and the feature specs that know a real id already cover those.
function systemPages(): string[] {
  const root = resolve(__dirname, '../../../../psp/frontend/src/app/system');
  const found: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Route groups `(x)` do not appear in the URL; `[x]` and `_x` are excluded outright.
        if (entry.name.startsWith('[') || entry.name.startsWith('_')) continue;
        const segment = entry.name.startsWith('(') ? '' : `/${entry.name}`;
        walk(join(dir, entry.name), `${route}${segment}`);
      } else if (entry.name === 'page.tsx') {
        found.push(route);
      }
    }
  };
  walk(root, '/system');
  return found.sort();
}

const PAGES = systemPages();

// A page that threw shows its error boundary; a page that failed to fetch shows an error banner. Neither is
// a load, however green the HTTP status was.
async function assertRendered(page: Page, path: string) {
  const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
  const broken = [
    'Application error',
    'Unhandled Runtime Error',
    'Internal Server Error',
    'This page could not be found',
    'Failed to fetch',
  ].find((marker) => body.includes(marker));
  expect(broken, `${path} rendered "${broken}"`).toBeUndefined();
  // Something was actually painted. A blank page passes every status check ever written.
  expect(body.trim().length, `${path} rendered an empty body`).toBeGreaterThan(40);
}

test.describe('v37 P11.5: the system pages against the running platform', () => {
  test.beforeAll(async ({ browser, request }) => {
    const health = await request.get(`${PSP}/api/v1/health`).catch(() => null);
    expect(health, 'the PSP must be running for this sweep to mean anything').not.toBeNull();

    // A real interactive sign-in, once, kept for every page below.
    const context = await browser.newContext();
    try {
      await signIn(await context.newPage());
      sessionCookies = await context.cookies();
      expect(
        sessionCookies.some((cookie) => cookie.name === 'demo_token'),
        'the sign-in left no session cookie, so every page below would redirect',
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  for (const path of PAGES) {
    test(`loads ${path}`, async ({ page }) => {
      const failures: string[] = [];
      // A 5xx from the API is the failure this sweep is for: the page may still paint a shell around it.
      page.on('response', (response) => {
        if (response.url().includes('/api/v1/') && response.status() >= 500) {
          failures.push(`${response.status()} ${response.url()}`);
        }
      });

      // A manager sees every page; a customer would legitimately be refused most of the admin ones.
      await page.context().addCookies(sessionCookies);
      const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);
      await page.waitForTimeout(1200);
      await assertRendered(page, path);
      expect(failures, `${path} produced server errors: ${failures.join(', ')}`).toEqual([]);
    });
  }
});
