/**
 * E2E: Application Mode — Payment Flow (FR-v1-01, FR-v1-03)
 * Authenticated 3-step checkout: card masking, confirmation, fraud alert.
 */
import { test, expect } from '@playwright/test';

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

const CUSTOMER_TOKEN = buildFakeJwt({ sub: 'u1', email: 'luis.fernandez@leafybank.demo', role: 'customer', name: 'Luis Fernandez', domain: 'local' });

test.describe('FR-v1-01/03: App Mode Payment', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{
      name: 'demo_token',
      value: CUSTOMER_TOKEN,
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 86400,
    }]);
  });

  test('03.1 renders Step 1 of authenticated checkout wizard', async ({ page }) => {
    await page.goto('/demo/payment');
    await expect(page.locator('text=/Step 1/i').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('input').first()).toBeVisible();
  });

  test('03.2 card number masked in real time, raw PAN note displayed', async ({ page }) => {
    await page.goto('/demo/payment');
    const cardInput = page.locator('input[placeholder*="card" i], input[type="text"]').first();
    await cardInput.fill('4111111111111111');
    await expect(page.locator('text=/\\*{4}/').first()).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('text=/raw PAN never stored/i').first()).toBeVisible();
  });

  test('03.3 Step 2 shows encryption notice and card token note', async ({ page }) => {
    await page.goto('/demo/payment');
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await expect(page.locator('text=/encrypt/i').first()).toBeVisible({ timeout: 4_000 });
    await expect(page.locator('text=/card token/i, text=/surrogate/i').first()).toBeVisible({ timeout: 4_000 });
  });

  test('03.4 successful payment shows confirmation with transaction ID', async ({ page }) => {
    const mockTxnId = `txn-e2e-${Date.now()}`;
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ cardTransactionInstanceReference: mockTxnId, cardTransactionStatus: 'authorized', fraudCaseCreated: false }) });
      } else route.continue();
    });
    await page.goto('/demo/payment');
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/Confirmed|✅/i').first()).toBeVisible({ timeout: 6_000 });
    await expect(page.locator(`text=/${mockTxnId.slice(0, 12)}/`).first()).toBeVisible();
  });

  test('03.5 fraud alert shown when API returns fraudCaseCreated=true', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ cardTransactionInstanceReference: 'txn-fraud-e2e', cardTransactionStatus: 'authorized', fraudCaseCreated: true, fraudDiagnosisInstanceReference: 'case-e2e-001' }) });
      } else route.continue();
    });
    await page.goto('/demo/payment');
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/fraud|suspicious|investigation/i').first()).toBeVisible({ timeout: 6_000 });
  });

  test('03.6 API error on confirm shows error message', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) });
      } else route.continue();
    });
    await page.goto('/demo/payment');
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/error/i').first()).toBeVisible({ timeout: 5_000 });
  });
});
