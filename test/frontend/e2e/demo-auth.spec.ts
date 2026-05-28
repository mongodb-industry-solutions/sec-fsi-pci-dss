/**
 * E2E: Application Mode — Authentication Flow (FR-v1-05)
 * Login, role-based redirect, auth guard, sign out.
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
  { email: 'luis.fernandez@leafybank.demo', name: 'Luis Fernandez', role: 'customer' },
  { email: 'julia.santos@leafybank.demo', name: 'Julia Santos', role: 'customer' },
  { email: 'sarah.chen@leafybank.demo', name: 'Sarah Chen', role: 'level1_analyst' },
  { email: 'michael.obi@leafybank.demo', name: 'Michael Obi', role: 'level2_investigator' },
  { email: 'admin@leafybank.demo', name: 'Admin User', role: 'security_auditor' },
];

test.describe('FR-v1-05: Application Mode Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.route('**/api/v1/auth/users', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) });
    });
  });

  test('05.1 login page renders and lists demo users', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.locator('text=/sarah.chen|leafybank/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('05.2 level1_analyst login redirects to /demo/investigation', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ token: buildFakeJwt({ sub: 'u3', email: 'sarah.chen@leafybank.demo', role: 'level1_analyst', name: 'Sarah Chen', domain: 'local' }), user: MOCK_USERS[2] }),
      });
    });
    await page.goto('/demo');
    await submitLogin(page, 'sarah.chen@leafybank.demo');
    await expect(page).toHaveURL(/\/demo\/investigation/, { timeout: 6_000 });
  });

  test('05.3 customer login redirects to /demo/payment', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ token: buildFakeJwt({ sub: 'u1', email: 'luis.fernandez@leafybank.demo', role: 'customer', name: 'Luis Fernandez', domain: 'local' }), user: MOCK_USERS[0] }),
      });
    });
    await page.goto('/demo');
    await submitLogin(page, 'luis.fernandez@leafybank.demo');
    await expect(page).toHaveURL(/\/demo\/payment/, { timeout: 6_000 });
  });

  test('05.4 invalid credentials shows error and stays on /demo', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid credentials' }) });
    });
    await page.goto('/demo');
    await submitLogin(page, 'sarah.chen@leafybank.demo', 'wrong-password');
    await expect(page.locator('text=/invalid|incorrect|error/i').first()).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL('/demo');
  });

  test('05.5 unauthenticated access to protected route redirects to /demo', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/demo/investigation');
    await expect(page).toHaveURL('/demo', { timeout: 6_000 });
  });

  test('05.6 sign out navigates back to /demo', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => {
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ token: buildFakeJwt({ sub: 'u3', email: 'sarah.chen@leafybank.demo', role: 'level1_analyst', name: 'Sarah Chen', domain: 'local' }), user: MOCK_USERS[2] }),
      });
    });
    await page.route('**/api/v1/fraud-cases**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], total: 0, page: 1, limit: 20 }) });
    });
    await page.goto('/demo');
    await submitLogin(page, 'sarah.chen@leafybank.demo');
    await expect(page).toHaveURL(/\/demo\/investigation/, { timeout: 6_000 });
    await page.locator('a:has-text("Sign out"), button:has-text("Sign out")').first().click();
    await expect(page).toHaveURL('/demo', { timeout: 4_000 });
  });
});

async function submitLogin(page: import('@playwright/test').Page, email: string, password = 'demo-password') {
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  if (await emailInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await emailInput.fill(email);
    const pwInput = page.locator('input[type="password"]').first();
    if (await pwInput.isVisible({ timeout: 500 }).catch(() => false)) await pwInput.fill(password);
  } else {
    // User card/button UI — click by user's display name derived from email
    const nameParts = email.split('@')[0].split('.');
    const displayName = nameParts.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    const btn = page.locator(`button:has-text("${displayName}"), [data-email="${email}"]`).first();
    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(300);
      return;
    }
  }
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
  await page.waitForTimeout(400);
}
