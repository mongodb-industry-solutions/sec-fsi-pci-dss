/**
 * E2E: Admin Integration Hub portal (FR-v6-01, FR-v6-02, FR-v6-03, FR-v6-06)
 * Routes: /system/admin, /system/admin/providers, /system/admin/providers/vendors/new
 *
 * Auth: injected via demo_token cookie using loginAs (NOT localStorage — app reads cookies only).
 */
import { test, expect } from '@playwright/test';
import { loginAs, json } from './support/auth';

const MOCK_INTEGRATIONS = [
  { externalProviderArrangementInstanceReference: 'int-internal-fds-001', externalProviderArrangementName: 'Internal Fraud Scoring', externalProviderArrangementType: 'fraud_detection',  externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'sync',  externalProviderHealthStatus: 'ok', bianServiceDomain: 'Fraud Diagnosis',       pciDssRequirements: ['Req.10.2.1'] },
  { externalProviderArrangementInstanceReference: 'int-internal-hrp-001', externalProviderArrangementName: 'Internal HRPC Check',   externalProviderArrangementType: 'hrp_sanctions',   externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'sync',  externalProviderHealthStatus: 'ok', bianServiceDomain: 'Party Reference Data', pciDssRequirements: ['Req.12.8']    },
  { externalProviderArrangementInstanceReference: 'int-internal-aml-001', externalProviderArrangementName: 'Internal AML Monitor',  externalProviderArrangementType: 'aml_monitoring',  externalProviderIsInternal: true,  externalProviderArrangementStatus: 'active', externalProviderMode: 'async', externalProviderHealthStatus: 'ok', bianServiceDomain: 'Regulatory Compliance', pciDssRequirements: ['Req.12.8']    },
];

// ── Auth guard tests ──────────────────────────────────────────────────────────

test.describe('FR-v6-01: manager access guard', () => {
  test('01.1 non-manager is redirected away from /system/admin', async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/admin');
    // Wait specifically for /system (login/dashboard), not /system/admin
    await expect(page).toHaveURL('/system', { timeout: 5_000 });
  });

  test('01.2 manager can access /system/admin without redirect', async ({ page, context }) => {
    await page.route('**/api/v1/providers/vendors**', (route) => route.fulfill(json({ integrations: MOCK_INTEGRATIONS })));
    await loginAs(context, 'manager');
    await page.goto('/system/admin');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 8_000 });
  });
});

// ── Admin dashboard tests ─────────────────────────────────────────────────────

test.describe('FR-v6-02: Admin Integration Hub dashboard', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/api/v1/providers/vendors**', (route) => route.fulfill(json({ integrations: MOCK_INTEGRATIONS })));
    await loginAs(context, 'manager');
  });

  test('02.1 dashboard shows the Integration Hub heading', async ({ page }) => {
    await page.goto('/system/admin');
    await expect(page.getByText('Integration Hub')).toBeVisible({ timeout: 8_000 });
  });

  test('02.2 dashboard shows 6 integration type tiles', async ({ page }) => {
    await page.goto('/system/admin');
    const tiles = ['Fraud Detection', 'HRP / Sanctions', 'KYC / Identity', 'KYB / Business', 'AML Monitoring', 'Credit Bureau'];
    for (const tile of tiles) {
      // .first() avoids strict-mode violation when sidebar nav also contains the tile name
      await expect(page.getByText(tile).first()).toBeVisible({ timeout: 8_000 });
    }
  });

  test('02.3 internal providers show "Built-in" badge', async ({ page }) => {
    await page.goto('/system/admin');
    await expect(page.getByText('Built-in').first()).toBeVisible({ timeout: 8_000 });
  });
});

// ── Integrations list tests ───────────────────────────────────────────────────

test.describe('FR-v6-03: Integrations list page', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/api/v1/providers/vendors**', (route) => route.fulfill(json({ integrations: MOCK_INTEGRATIONS })));
    await loginAs(context, 'manager');
  });

  test('03.1 shows provider names and types', async ({ page }) => {
    await page.goto('/system/admin/providers');
    await expect(page.getByText('Internal Fraud Scoring')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Internal HRPC Check')).toBeVisible({ timeout: 8_000 });
  });

  test('03.2 shows Built-in badge for internal providers', async ({ page }) => {
    await page.goto('/system/admin/providers');
    await expect(page.getByText('Built-in').first()).toBeVisible({ timeout: 8_000 });
  });

  test('03.3 has "Register Provider" link to /system/admin/providers/vendors/new', async ({ page }) => {
    await page.goto('/system/admin/providers');
    const link = page.getByRole('link', { name: 'Register Provider' });
    await expect(link).toBeVisible({ timeout: 8_000 });
    await expect(link).toHaveAttribute('href', '/system/admin/providers/vendors/new');
  });

  test('03.4 internal providers do not show Suspend button', async ({ page }) => {
    await page.goto('/system/admin/providers');
    await expect(page.getByText('Internal Fraud Scoring')).toBeVisible({ timeout: 8_000 });
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow.getByRole('button', { name: 'Suspend' })).not.toBeVisible();
  });
});

// ── Register provider tests ───────────────────────────────────────────────────

test.describe('FR-v6-06: Register integration wizard', () => {
  test.beforeEach(async ({ context }) => {
    await loginAs(context, 'manager');
  });

  test('06.1 /system/admin/providers/vendors/new renders the registration form', async ({ page }) => {
    await page.goto('/system/admin/providers/vendors/new');
    // Use heading role to avoid strict-mode: page has both an <h1> and a submit button with this text
    await expect(page.getByRole('heading', { name: 'Register Provider' })).toBeVisible({ timeout: 8_000 });
    // Use exact placeholder — URL input also matches /provider/i but we want the name field
    await expect(page.getByPlaceholder('e.g. Sardine Fraud API')).toBeVisible({ timeout: 8_000 });
  });

  test('06.2 submitting the form calls POST /api/v1/providers/vendors and shows the API key once', async ({ page }) => {
    const fakeApiKey = 'sk_demo_abcdef1234567890abcdef1234567890';
    // api.integrations.create calls POST /api/v1/providers/vendors (not /api/v1/providers/vendors)
    await page.route('**/api/v1/providers/vendors', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill(json({
          integration: {
            externalProviderArrangementInstanceReference: 'ext-test-001',
            externalProviderArrangementName: 'Sardine FDS Test',
            externalProviderArrangementStatus: 'test',
          },
          apiKey: fakeApiKey,
        }, 201));
      } else {
        route.fulfill(json({ integrations: [] }));
      }
    });

    await page.goto('/system/admin/providers/vendors/new');
    await page.getByPlaceholder('e.g. Sardine Fraud API').fill('Sardine FDS Test');
    await page.locator('select').first().selectOption('fraud_detection');
    await page.fill('input[type="url"]', 'https://api.sardine.ai/v1/score');
    await page.getByRole('button', { name: 'Register Provider' }).click();

    await expect(page.getByText(fakeApiKey)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('not be shown again', { exact: false })).toBeVisible();
  });
});
