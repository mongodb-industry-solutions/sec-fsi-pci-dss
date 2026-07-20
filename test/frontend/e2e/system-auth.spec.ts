/**
 * E2E: Application Mode authentication + role dashboards (FR-v1-05, FR-v4-P8)
 * Route: /system  — login form, then inline role-based dashboard (no redirect).
 * Replaces the legacy demo-auth.spec.ts which targeted the removed /demo/* routes.
 */
import { test, expect } from '@playwright/test';
import { loginAs, json, mintJwt, DemoRole } from './support/auth';

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

test.describe('FR-v1-05: login form', () => {
  test.beforeEach(async ({ page, context }) => { await context.clearCookies(); await stubCommon(page); });

  test('renders the Leafy Pay sign-in form', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByRole('heading', { name: 'Leafy Pay' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('successful login renders the role dashboard inline', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (r) =>
      r.fulfill(json({ token: mintJwt({ role: 'customer', sub: 'u1', email: 'luis.fernandez@back.es', name: 'Luis Fernandez' }) })));
    await page.goto('/system');
    await page.locator('input[type="email"]').fill('luis.fernandez@back.es');
    await page.locator('input[type="password"]').fill('demo-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /Welcome, Luis/ })).toBeVisible({ timeout: 8000 });
  });

  test('invalid credentials show an error and stay on the form', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (r) => r.fulfill(json({ error: 'Invalid credentials' }, 401)));
    await page.goto('/system');
    await page.locator('input[type="email"]').fill('luis.fernandez@back.es');
    await page.locator('input[type="password"]').fill('wrong');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('text=/invalid|error|failed/i').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Leafy Pay' })).toBeVisible();
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
    // Sign out lives in the UserMenu dropdown — open it via the header trigger
    // (identified by the signed-in user's name) once the dashboard is hydrated.
    const trigger = page.getByRole('button', { name: /Sarah Chen/i });
    await expect(trigger).toBeVisible({ timeout: 8000 });
    await trigger.click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(signOut).toBeVisible({ timeout: 4000 });
    await signOut.click();
    await expect(page.getByRole('heading', { name: 'Leafy Pay' })).toBeVisible({ timeout: 6000 });
  });
});

test.describe('FR-v1-05: auth guard', () => {
  test('unauthenticated access to a protected route redirects to /system login', async ({ page, context }) => {
    await context.clearCookies();
    await stubCommon(page);
    await page.goto('/system/transactions');
    await expect(page).toHaveURL(/\/system$/, { timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Leafy Pay' })).toBeVisible({ timeout: 6000 });
  });
});
