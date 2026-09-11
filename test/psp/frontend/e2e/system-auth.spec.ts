/**
 * E2E: Application Mode authentication + role dashboards (FR-v1-05, FR-v4-P8)
 * Route: /system, login form, then inline role-based dashboard (no redirect).
 * Replaces the legacy demo-auth.spec.ts which targeted the removed /demo/* routes.
 */
import { test, expect } from '@playwright/test';
import { loginAs, json, DemoRole } from './support/auth';
// Brand name is a single source of truth (frontend/src/config/brand.ts); read it here so the auth
// assertions survive a rebrand instead of hard-coding the product name.
import { BRAND } from '../../../../psp/frontend/src/config/brand';

const DOMAINS = { domains: [{ name: 'local', displayName: 'Local (Demo Users)', type: 'local', flowType: 'client_credentials' }] };
const USERS = { users: [
  { email: 'luis.fernandez@back.es', name: 'Luis Fernandez', role: 'customer', featured: true },
  { email: 'sarah.chen@back.es',     name: 'Sarah Chen',     role: 'level1_analyst', featured: true },
] };

// Mocks shared by login + dashboard so RoleStats / integrations never hang.
async function stubCommon(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/domains', (r) => r.fulfill(json(DOMAINS)));
  await page.route('**/api/v1/system/users**', (r) => r.fulfill(json(USERS)));
  await page.route('**/api/v1/fraud/stats**', (r) => r.fulfill(json({ total: 0, open: 0, underReview: 0, escalated: 0, resolvedFraud: 0, resolvedCleared: 0, byStatus: [], bySeverity: [], byMonth: [] })));
  await page.route('**/api/v1/providers/vendors**', (r) => r.fulfill(json({ integrations: [] })));
  await page.route('**/api/v1/providers/vendors**', (r) => r.fulfill(json({ integrations: [] })));
}

test.describe('FR-v1-05: sign-in is handed to the authority', () => {
  /**
   * This console has NO password form, and that is the property under test.
   *
   * These three cases used to fill an email and a password on `/system` and stub a POST to
   * `/api/v1/auth/login`. Both are gone: the identity extraction left this application with no
   * route that accepts a credential, and `/api/auth/login` is GET only because it starts an
   * authorization code flow. Asserting the old form would be asserting a capability the app
   * deliberately gave up, so these assert the giving up instead.
   */
  test.beforeEach(async ({ page, context }) => { await context.clearCookies(); await stubCommon(page); });

  test('offers to sign in, and says where the credential goes', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByRole('heading', { name: `${BRAND.primary} ${BRAND.secondary}` })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
    // The promise made to the person signing in, kept where they can read it.
    await expect(page.getByText(/credentials are never entered here/i)).toBeVisible();
  });

  test('asks for no credential anywhere on the page', async ({ page }) => {
    // The regression that matters: a password box reappearing here would mean this app had started
    // handling credentials again, whatever it then did with them.
    await page.goto('/system');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });

  test('sends the browser to the authority, not to a local form', async ({ page }) => {
    await page.goto('/system');
    // Followed only as far as the redirect target: the authority's own sign-in page is its suite to
    // test, and requiring it up would make this spec fail for a reason it is not about.
    const target = await page.getByRole('link', { name: /Sign in/i }).getAttribute('href');
    expect(target).toBe('/api/auth/login');

    const response = await page.request.get('/api/auth/login', { maxRedirects: 0 });
    expect(response.status(), 'sign-in did not redirect').toBeGreaterThanOrEqual(300);
    const location = response.headers()['location'] ?? '';
    expect(location, 'the redirect did not name an authorization request').toContain('response_type=code');
    // PKCE, so an intercepted code is not redeemable on its own.
    expect(location).toContain('code_challenge=');
  });
});

test.describe('FR-v1-05: role-based dashboards', () => {
  // Each role lands on /system and sees its own dashboard cards (rendered inline).
  const CASES: { role: DemoRole; marker: RegExp }[] = [
    { role: 'customer',            marker: /New Payment/ },
    { role: 'level1_analyst',      marker: /Cases/ },
    { role: 'level2_investigator', marker: /Cases/ },
    { role: 'security_auditor',    marker: /Audit Log/ },
    { role: 'merchant_officer',    marker: /Review Queue/ },
    { role: 'manager',             marker: /Integration Hub/ },
  ];

  for (const { role, marker } of CASES) {
    test(`${role} sees its dashboard`, async ({ page, context }) => {
      await stubCommon(page);
      await loginAs(context, role);
      await page.goto('/system');
      await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(marker).first()).toBeVisible({ timeout: 8000 });
    });
  }

  test('sign out returns to the login form', async ({ page, context }) => {
    await stubCommon(page);
    await loginAs(context, 'level1_analyst');
    await page.goto('/system');
    await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible({ timeout: 15000 });
    // Sign out lives in the UserMenu dropdown: open it via the header trigger
    // (identified by the signed-in user's name) once the dashboard is hydrated.
    const trigger = page.getByRole('button', { name: /Sarah Chen/i });
    await expect(trigger).toBeVisible({ timeout: 8000 });
    await trigger.click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(signOut).toBeVisible({ timeout: 4000 });
    await signOut.click();
    await expect(page.getByRole('heading', { name: BRAND.full })).toBeVisible({ timeout: 6000 });
  });
});

test.describe('FR-v1-05: auth guard', () => {
  test('unauthenticated access to a protected route redirects to /system login', async ({ page, context }) => {
    await context.clearCookies();
    await stubCommon(page);
    await page.goto('/system/transactions');
    await expect(page).toHaveURL(/\/system$/, { timeout: 8000 });
    await expect(page.getByRole('heading', { name: BRAND.full })).toBeVisible({ timeout: 6000 });
  });
});
