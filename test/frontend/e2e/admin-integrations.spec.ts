/**
 * E2E: Admin Integration Hub portal (FR-v6-01, FR-v6-02, FR-v6-03, FR-v6-06)
 * Routes: /system/admin, /system/admin/integrations, /system/admin/integrations/new
 */
import { test, expect } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

const SYSTEM_ADMIN_JWT = buildJwt({
  sub: 'a1000070-0000-4000-8000-000000000070',
  email: 'admin.system@leafybank.demo',
  role: 'system_admin',
  name: 'System Administrator',
  domain: 'leafybank',
});

const ANALYST_JWT = buildJwt({
  sub: 'analyst-id-001',
  email: 'sarah.chen@leafybank.demo',
  role: 'level1_analyst',
  name: 'Sarah Chen',
  domain: 'leafybank',
});

const MOCK_INTEGRATIONS = [
  { externalProviderArrangementInstanceReference: 'int-internal-fds-001', externalProviderArrangementName: 'Internal Fraud Scoring', externalProviderArrangementType: 'fraud_detection',  externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'sync', externalProviderHealthStatus: 'ok', bianServiceDomain: 'Fraud Diagnosis', pciDssRequirements: ['Req.10.2.1'] },
  { externalProviderArrangementInstanceReference: 'int-internal-hrp-001', externalProviderArrangementName: 'Internal HRPC Check',   externalProviderArrangementType: 'hrp_sanctions',   externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'sync', externalProviderHealthStatus: 'ok', bianServiceDomain: 'Party Reference Data', pciDssRequirements: ['Req.12.8'] },
  { externalProviderArrangementInstanceReference: 'int-internal-aml-001', externalProviderArrangementName: 'Internal AML Monitor',  externalProviderArrangementType: 'aml_monitoring',  externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'async', externalProviderHealthStatus: 'ok', bianServiceDomain: 'Regulatory Compliance', pciDssRequirements: ['Req.12.8'] },
];

// ── Auth guard tests ─────────────────────────────────────────────────────────

test.describe('FR-v6-01: system_admin access guard', () => {
  test('01.1 non-system_admin is redirected away from /system/admin', async ({ page }) => {
    await page.evaluate((jwt) => localStorage.setItem('demo_token', jwt), ANALYST_JWT);
    await page.goto('/system/admin');
    await page.waitForURL('**/system**', { timeout: 5_000 });
    expect(page.url()).not.toContain('/system/admin');
  });

  test('01.2 system_admin can access /system/admin without redirect', async ({ page }) => {
    await page.route('**/api/v1/integrations**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ integrations: MOCK_INTEGRATIONS }) });
    });
    await page.evaluate((jwt) => localStorage.setItem('demo_token', jwt), SYSTEM_ADMIN_JWT);
    await page.goto('/system/admin');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 8_000 });
  });
});

// ── Admin dashboard tests ─────────────────────────────────────────────────────

test.describe('FR-v6-02: Admin Integration Hub dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/integrations**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ integrations: MOCK_INTEGRATIONS }) });
    });
    await page.evaluate((jwt) => localStorage.setItem('demo_token', jwt), SYSTEM_ADMIN_JWT);
  });

  test('02.1 dashboard shows the Integration Hub heading', async ({ page }) => {
    await page.goto('/system/admin');
    await expect(page.getByText('Integration Hub')).toBeVisible({ timeout: 8_000 });
  });

  test('02.2 dashboard shows 6 integration type tiles', async ({ page }) => {
    await page.goto('/system/admin');
    const tiles = [
      'Fraud Detection',
      'HRP / Sanctions',
      'KYC / Identity',
      'KYB / Business',
      'AML Monitoring',
      'Credit Bureau',
    ];
    for (const tile of tiles) {
      await expect(page.getByText(tile)).toBeVisible({ timeout: 8_000 });
    }
  });

  test('02.3 internal providers show "Built-in" badge', async ({ page }) => {
    await page.goto('/system/admin');
    const builtInBadges = page.getByText('Built-in');
    await expect(builtInBadges.first()).toBeVisible({ timeout: 8_000 });
  });
});

// ── Integrations list tests ───────────────────────────────────────────────────

test.describe('FR-v6-03: Integrations list page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/integrations**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ integrations: MOCK_INTEGRATIONS }) });
    });
    await page.evaluate((jwt) => localStorage.setItem('demo_token', jwt), SYSTEM_ADMIN_JWT);
  });

  test('03.1 shows provider names and types', async ({ page }) => {
    await page.goto('/system/admin/integrations');
    await expect(page.getByText('Internal Fraud Scoring')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Internal HRPC Check')).toBeVisible({ timeout: 8_000 });
  });

  test('03.2 shows Built-in badge for internal providers', async ({ page }) => {
    await page.goto('/system/admin/integrations');
    const badges = page.getByText('Built-in');
    await expect(badges.first()).toBeVisible({ timeout: 8_000 });
  });

  test('03.3 has "Register Provider" link to /system/admin/integrations/new', async ({ page }) => {
    await page.goto('/system/admin/integrations');
    const link = page.getByRole('link', { name: 'Register Provider' });
    await expect(link).toBeVisible({ timeout: 8_000 });
    await expect(link).toHaveAttribute('href', '/system/admin/integrations/new');
  });

  test('03.4 internal providers do not show Suspend button', async ({ page }) => {
    await page.goto('/system/admin/integrations');
    // Wait for table to load
    await expect(page.getByText('Internal Fraud Scoring')).toBeVisible({ timeout: 8_000 });
    // The first row (internal) should not have a Suspend button visible for it
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow.getByRole('button', { name: 'Suspend' })).not.toBeVisible();
  });
});

// ── Register provider tests ───────────────────────────────────────────────────

test.describe('FR-v6-06: Register integration wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate((jwt) => localStorage.setItem('demo_token', jwt), SYSTEM_ADMIN_JWT);
  });

  test('06.1 /system/admin/integrations/new renders the registration form', async ({ page }) => {
    await page.goto('/system/admin/integrations/new');
    await expect(page.getByText('Register Provider')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByPlaceholder(/sardine|provider/i)).toBeVisible({ timeout: 8_000 });
  });

  test('06.2 submitting the form calls POST /api/v1/integrations and shows the API key once', async ({ page }) => {
    const fakeApiKey = 'sk_demo_abcdef1234567890abcdef1234567890';
    await page.route('**/api/v1/integrations', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            integration: {
              externalProviderArrangementInstanceReference: 'ext-test-001',
              externalProviderArrangementName: 'Sardine FDS Test',
              externalProviderArrangementStatus: 'test',
            },
            apiKey: fakeApiKey,
          }),
        });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrations":[]}' });
      }
    });

    await page.goto('/system/admin/integrations/new');
    await page.getByPlaceholder(/sardine|provider/i).fill('Sardine FDS Test');
    await page.locator('select').first().selectOption('fraud_detection');
    await page.fill('input[type="url"]', 'https://api.sardine.ai/v1/score');
    await page.getByRole('button', { name: 'Register Provider' }).click();

    // The API key should appear exactly once in the success screen
    await expect(page.getByText(fakeApiKey)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('save it now', { exact: false })).toBeVisible();
  });
});
