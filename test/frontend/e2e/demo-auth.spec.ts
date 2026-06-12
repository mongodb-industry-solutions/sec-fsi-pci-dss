/**
 * E2E: Application Mode - Authentication Flow (FR-v1-05)
 * Login, post-login dashboard, auth guard, sign out.
 *
 * Routes: Application Mode lives at /system (login + dashboard after auth).
 * After login the URL stays at /system — there is no post-login redirect to a
 * sub-route. Auth guard in system/layout.tsx redirects sub-routes to /system
 * when no valid token is present.
 */
import { test, expect } from '@playwright/test';

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

const MOCK_USERS = [
  { email: 'luis.fernandez@back.es', name: 'Luis Fernandez', role: 'customer' },
  { email: 'julia.santos@back.es',   name: 'Julia Santos',   role: 'customer' },
  { email: 'sarah.chen@back.es',     name: 'Sarah Chen',     role: 'level1_analyst' },
  { email: 'michael.obi@back.es',    name: 'Michael Obi',    role: 'level2_investigator' },
  { email: 'admin@back.es',          name: 'Admin User',     role: 'security_auditor' },
];

test.describe('FR-v1-05: Application Mode Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Stub users list (used by debug-mode select dropdown)
    await page.route('**/api/v1/auth/users**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) });
    });
    await page.route('**/api/v1/system/users**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: MOCK_USERS }) });
    });
  });

  test('05.1 login page at /system renders email input and Sign In button', async ({ page }) => {
    await page.goto('/system');
    // Login form shows email input and Sign In button (no auth token set)
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('button[type="submit"]').first()).toBeVisible({ timeout: 4_000 });
  });

  test('05.2 level1_analyst login shows welcome dashboard at /system', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          token: buildFakeJwt({ sub: 'u3', email: 'sarah.chen@back.es', role: 'level1_analyst', name: 'Sarah Chen', domain: 'local' }),
          user: MOCK_USERS[2],
        }),
      });
    });
    await page.goto('/system');
    await submitLogin(page, 'sarah.chen@back.es');
    // After login: URL stays /system, RoleDashboard renders with user name
    await expect(page).toHaveURL('/system');
    await expect(page.locator('text=/Welcome, Sarah/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('05.3 customer login shows welcome dashboard at /system', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          token: buildFakeJwt({ sub: 'u1', email: 'luis.fernandez@back.es', role: 'customer', name: 'Luis Fernandez', domain: 'local' }),
          user: MOCK_USERS[0],
        }),
      });
    });
    await page.goto('/system');
    await submitLogin(page, 'luis.fernandez@back.es');
    await expect(page).toHaveURL('/system');
    await expect(page.locator('text=/Welcome, Luis/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('05.4 invalid credentials shows error and stays on /system', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid credentials' }) });
    });
    await page.goto('/system');
    await submitLogin(page, 'sarah.chen@back.es', 'wrong-password');
    await expect(page.locator('text=/invalid|incorrect|error/i').first()).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL('/system');
  });

  test('05.5 unauthenticated access to protected route redirects to /system', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/system/investigation');
    // system/layout.tsx redirects to /system when no valid token
    await expect(page).toHaveURL('/system', { timeout: 6_000 });
  });

  test('05.6 sign out returns to login form at /system', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          token: buildFakeJwt({ sub: 'u3', email: 'sarah.chen@back.es', role: 'level1_analyst', name: 'Sarah Chen', domain: 'local' }),
          user: MOCK_USERS[2],
        }),
      });
    });
    // Stub fraud stats with the correct shape so RoleStats doesn't crash on render
    await page.route('**/api/v1/fraud/stats**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, open: 0, underReview: 0, escalated: 0, resolvedFraud: 0, resolvedCleared: 0, byStatus: [], bySeverity: [], byMonth: [] }) });
    });
    await page.goto('/system');
    await submitLogin(page, 'sarah.chen@back.es');
    await expect(page.locator('text=/Welcome, Sarah/i').first()).toBeVisible({ timeout: 8_000 });
    // Sign out is in a UserMenu dropdown — open via the header trigger first
    const trigger = page.locator('header button[aria-haspopup="menu"]');
    if (await trigger.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await trigger.click();
      await page.getByRole('menuitem', { name: /sign out/i }).click({ timeout: 4_000 });
    } else {
      // Fallback: direct sign-out button (some layouts expose it without a dropdown)
      await page.locator('button:has-text("Sign out"), button:has-text("sign out")').first().click({ timeout: 4_000 });
    }
    // LoginForm renders again at same /system URL
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 6_000 });
  });
});

async function submitLogin(page: import('@playwright/test').Page, email: string, password = 'demo-password') {
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 6_000 });
  await emailInput.fill(email);
  const pwInput = page.locator('input[type="password"]').first();
  if (await pwInput.isVisible({ timeout: 500 }).catch(() => false)) await pwInput.fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(300);
}
