/**
 * E2E: Application Mode - Payment Flow (FR-v1-01, FR-v1-03)
 * Authenticated 3-step checkout: step labels, confirmation, fraud alert.
 *
 * Routes: /system/payment
 * Steps:  1 = "Card & amount", 2 = "Review & describe", 3 = "Confirmed"
 * Nav:    "Next" button advances 1→2; "Confirm Payment" submits on step 2.
 * Auth:   demo_token cookie injected via loginAs helper.
 */
import { test, expect } from '@playwright/test';
import { loginAs, json } from './support/auth';

test.describe('FR-v1-01/03: App Mode Payment', () => {
  test.beforeEach(async ({ context }) => {
    await loginAs(context, 'customer');
  });

  test('03.1 renders Step 1 (Card & amount) of checkout wizard', async ({ page }) => {
    await page.goto('/system/payment');
    // Step indicator shows "Card & amount" label on sm+ screens
    await expect(page.locator('text=/Card.*amount/i').first()).toBeVisible({ timeout: 8_000 });
    // At least one interactive element visible (amount preset button or similar)
    await expect(page.locator('button, select').first()).toBeVisible();
  });

  test('03.2 masked card display is shown at step 1', async ({ page }) => {
    await page.goto('/system/payment');
    // Page pre-selects first VISA card preset; masked PAN is shown immediately
    await expect(page.locator('text=/\\*{4}/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('03.3 Step 2 shows review label and encryption notice', async ({ page }) => {
    await page.goto('/system/payment');
    await page.locator('button:has-text("Next")').first().click();
    await expect(page.locator('text=/Review|describe/i').first()).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('text=/encrypt/i').first()).toBeVisible({ timeout: 4_000 });
  });

  test('03.4 successful payment shows Payment Confirmed with transaction ID', async ({ page }) => {
    const mockTxnId = 'txn-e2e-test-001';
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill(json({ cardTransactionInstanceReference: mockTxnId, cardTransactionStatus: 'authorized', fraudCaseCreated: false }));
      } else {
        route.continue();
      }
    });
    await page.goto('/system/payment');
    await page.locator('button:has-text("Next")').first().click();
    await page.locator('button:has-text("Confirm")').first().click();
    await expect(page.locator('text=/Confirmed|✅/i').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(`text=/${mockTxnId.slice(0, 12)}/`).first()).toBeVisible();
  });

  test('03.5 fraud alert shown when API returns fraudCaseCreated=true', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill(json({ cardTransactionInstanceReference: 'txn-fraud-e2e', cardTransactionStatus: 'authorized', fraudCaseCreated: true, fraudDiagnosisInstanceReference: 'case-e2e-001' }));
      } else {
        route.continue();
      }
    });
    await page.goto('/system/payment');
    await page.locator('button:has-text("Next")').first().click();
    await page.locator('button:has-text("Confirm")').first().click();
    await expect(page.locator('text=/fraud|suspicious|investigation/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('03.6 API error on confirm shows error message', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill(json({ error: 'Internal server error' }, 500));
      } else {
        route.continue();
      }
    });
    await page.goto('/system/payment');
    await page.locator('button:has-text("Next")').first().click();
    await page.locator('button:has-text("Confirm")').first().click();
    await expect(page.locator('text=/error/i').first()).toBeVisible({ timeout: 6_000 });
  });
});
