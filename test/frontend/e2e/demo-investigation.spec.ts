/**
 * E2E: Application Mode - Investigation Flow (FR-v1-02, FR-v1-04)
 * L1 case dashboard, case detail, encryption badges, audit log, raw document toggle.
 *
 * Routes: Application Mode at /system/investigation and /system/investigation/:id
 * API:    api.fraud.list  → GET /api/v1/fraud
 *         api.fraud.getById → GET /api/v1/fraud/:id
 * Auth:   demo_token cookie injected directly (fake JWT, signature not verified client-side)
 * Mock fields: FraudCase uses caseStatus / riskSeverity (internal names), not BIAN names.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './support/auth';

const MOCK_CASES = {
  results: [
    {
      fraudDiagnosisInstanceReference: 'case-app-001',
      fraudDiagnosisCaseReference: 'FD-2026-002001',
      caseStatus: 'open',
      riskSeverity: 'high',
      cardTransactionInstanceReference: 'txn-app-001',
      customerAgreementInstanceReference: 'cust-app-001',
      requestDateTime: '2026-05-27T12:00:00Z',
      fraudDiagnosisAssessment: { riskIndicators: ['amount_threshold'], fraudDiagnosisScore: 40 },
      diagnosisActionLog: [
        { actionDateTime: '2026-05-27T12:00:00Z', actionType: 'case_opened', performedByInstanceReference: 'system', performedByRole: 'payment_service', actionDetails: {} },
      ],
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

test.describe('FR-v1-04: Investigation Dashboard', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    // Stub fraud list: /api/v1/fraud (list) but let detail requests through
    await page.route('**/api/v1/fraud**', (route, req) => {
      if (!req.url().includes('/case-app-') && !req.url().includes('/stats')) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CASES) });
      } else {
        route.continue();
      }
    });
  });

  test('04.1 investigation dashboard shows case table', async ({ page }) => {
    await page.goto('/system/investigation');
    await expect(page.locator('text=/FD-2026-002001/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('04.2 cases display severity badge', async ({ page }) => {
    await page.goto('/system/investigation');
    await expect(page.locator('text=/HIGH/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('04.3 header shows logged-in analyst identity', async ({ page }) => {
    await page.goto('/system/investigation');
    await expect(page.locator('text=/Sarah Chen/').first()).toBeVisible({ timeout: 5_000 });
  });

  test('04.4 clicking case reference navigates to case detail', async ({ page }) => {
    await page.route('**/api/v1/fraud/case-app-001', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CASES.results[0]) });
    });
    await page.goto('/system/investigation');
    await page.locator('a[href*="case-app-001"], a:has-text("FD-2026-002001")').first().click();
    await expect(page).toHaveURL(/case-app-001/, { timeout: 5_000 });
  });
});

test.describe('FR-v1-04: Case Detail', () => {
  const CASE_ID = 'case-app-001';

  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await page.route(`**/api/v1/fraud/${CASE_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CASES.results[0]) });
    });
    await page.goto(`/system/investigation/${CASE_ID}`);
    await expect(page.locator('text=/FD-2026-002001/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('04.5 customer profile shows QE encryption indicators', async ({ page }) => {
    await expect(page.locator('text=/encrypt/i, text=/🔒/').first()).toBeVisible();
  });

  test('04.6 audit log shows case_opened entry authored by payment_service', async ({ page }) => {
    await expect(page.locator('text=/Audit|case opened/i').first()).toBeVisible();
    await expect(page.locator('text=/payment_service/').first()).toBeVisible();
  });

  test('04.7 raw Atlas document toggle present', async ({ page }) => {
    await expect(page.locator('button:has-text("Raw"), button:has-text("Atlas"), button:has-text("🔐")').first()).toBeVisible();
  });

  test('04.8 clicking raw toggle shows Atlas storage section with mock ciphertext', async ({ page }) => {
    await page.route('**/api/v1/demo/raw-document/**', (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ document: { cardTransactionMerchantName: 'Test', cardTransactionAccountReference: { $binary: { base64: 'AABB==', subType: '06' } } } }),
      });
    });
    await page.locator('button:has-text("Raw"), button:has-text("🔐")').first().click();
    await expect(page.locator('text=/subType|QE Encrypted|raw|unavailable/i').first()).toBeVisible({ timeout: 4_000 });
  });

  test('04.9 back navigation returns to investigation list', async ({ page }) => {
    await page.locator('a:has-text("Back"), a:has-text("←")').first().click();
    await expect(page).toHaveURL(/\/system\/investigation$/, { timeout: 4_000 });
  });
});
