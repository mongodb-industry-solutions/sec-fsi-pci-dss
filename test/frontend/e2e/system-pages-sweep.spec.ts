/**
 * v37 P11.5: every /system page loads and shows data, against the REAL services.
 *
 * Deliberately unmocked. The rest of the e2e suite stubs the API so it can assert a specific rendering
 * without a database; this one exists to catch the opposite failure: a page that renders perfectly against a
 * stub and is blank against the extracted system, because the capability behind it now resolves to the bank.
 * A stub would hide exactly the regression this phase is looking for.
 *
 * Requires the PSP, the bank and the frontend running. It fails rather than skips when they are not, because
 * a compatibility pass that silently passes on a dead environment is worse than no pass.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

const PSP = process.env.PSP_API_URL ?? 'http://localhost:8081';

// A REAL token from the running backend, not the fake-signature one the mocked specs use: those pass the
// frontend's decode and are rejected by every API call, which would leave every page here empty for a reason
// that has nothing to do with the platform.
async function loginForReal(context: BrowserContext): Promise<string> {
  const response = await context.request.post(`${PSP}/api/v1/auth/login`, {
    data: { email: 'alex.rivera@back.es', password: 'demo-password' },
  });
  expect(response.status(), 'the sweep needs a real session to mean anything').toBe(200);
  const token = (await response.json()).token as string;
  await context.addCookies([{
    name: 'demo_token', value: token, domain: 'localhost', path: '/',
    expires: Math.floor(Date.now() / 1000) + 86400,
  }]);
  return token;
}

// Derived from the filesystem rather than hand-listed, so a page added later is swept without anyone
// remembering to add it here. Dynamic segments are excluded: sweeping `[id]` with an invented id would assert
// a not-found page and prove nothing, and the feature specs that know a real id already cover those.
function systemPages(): string[] {
  const root = resolve(__dirname, '../../../frontend/src/app/system');
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
  test.beforeAll(async ({ request }) => {
    const health = await request.get('http://localhost:8081/api/v1/health').catch(() => null);
    expect(health, 'the PSP must be running for this sweep to mean anything').not.toBeNull();
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
      await loginForReal(page.context());
      const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);
      await page.waitForTimeout(1200);
      await assertRendered(page, path);
      expect(failures, `${path} produced server errors: ${failures.join(', ')}`).toEqual([]);
    });
  }
});
