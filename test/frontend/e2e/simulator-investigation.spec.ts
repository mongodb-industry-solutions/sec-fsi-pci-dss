/**
 * E2E: Simulator Mode — Investigation Flow (FR-v1-02)
 * Search by QE fields, case table, case detail with encryption badges, raw document toggle.
 */
import { test, expect } from '@playwright/test';

const MOCK_CASE = {
  fraudDiagnosisInstanceReference: 'case-sim-e2e',
  caseReference: 'FD-2026-001001',
  fraudDiagnosisCaseStatus: 'open',
  fraudDiagnosisCaseSeverity: 'high',
  linkedCardTransactionReference: 'txn-001',
  linkedCustomerAgreementReference: 'cust-001',
  fraudDiagnosisRequestDateTime: '2026-05-27T10:00:00Z',
  fraudDiagnosisAssessment: { riskIndicators: ['amount_threshold'], fraudDiagnosisScore: 40 },
  diagnosisActionLog: [
    { actionDateTime: '2026-05-27T10:00:00Z', actionType: 'case_opened', performedByInstanceReference: 'system', performedByRole: 'payment_service', actionDetails: {} },
  ],
};

test.describe('FR-v1-02: Simulator Investigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/simulator/investigation');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 8_000 });
  });

  test('02.1 renders search input and field selector', async ({ page }) => {
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.locator('select, [role="combobox"]').first()).toBeVisible();
  });

  test('02.2 submitting search calls the customer-agreements API', async ({ page }) => {
    let requestMade = false;
    await page.route('**/api/v1/customer-agreements**', (route) => {
      requestMade = true;
      route.fulfill({ status: 200, body: JSON.stringify(null) });
    });
    await page.locator('input[type="text"]').first().fill('test@example.com');
    await page.locator('button[type="submit"], button:has-text("Search")').first().click();
    await page.waitForTimeout(800);
    expect(requestMade).toBe(true);
  });

  test('02.3 case table renders when fraud cases are returned', async ({ page }) => {
    await page.route('**/api/v1/fraud-cases**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [MOCK_CASE], total: 1, page: 1, limit: 20 }),
      });
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/FD-2026-001001/').first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('FR-v1-02: Case Detail Page', () => {
  const CASE_ID = 'case-sim-e2e';

  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/v1/fraud-cases/${CASE_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CASE),
      });
    });
    await page.goto(`/simulator/investigation/${CASE_ID}`);
    await expect(page.locator('text=/FD-2026-001001/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('02.4 case detail shows severity and status badges', async ({ page }) => {
    await expect(page.locator('text=/HIGH/i').first()).toBeVisible();
    await expect(page.locator('text=/open/i').first()).toBeVisible();
  });

  test('02.5 encryption badges visible on QE fields (EncryptionBadge component)', async ({ page }) => {
    await expect(page.locator('text=/encrypt/i, text=/🔒/').first()).toBeVisible();
  });

  test('02.6 audit log section shows case_opened action', async ({ page }) => {
    await expect(page.locator('text=/case opened/i, text=/Audit/i').first()).toBeVisible();
    await expect(page.locator('text=/payment_service/').first()).toBeVisible();
  });

  test('02.7 raw Atlas document toggle is present', async ({ page }) => {
    await expect(
      page.locator('button:has-text("Raw"), button:has-text("Atlas"), button:has-text("🔐")').first()
    ).toBeVisible();
  });

  test('02.8 clicking raw toggle shows Atlas storage section', async ({ page }) => {
    await page.route(`**/api/v1/demo/raw-document/**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ document: { merchantName: 'Test', cardTransactionAccountReference: { $binary: { base64: 'AABB', subType: '06' } } } }),
      });
    });
    await page.locator('button:has-text("Raw"), button:has-text("🔐")').first().click();
    await expect(
      page.locator('text=/subType|QE Encrypted|raw|unavailable/i').first()
    ).toBeVisible({ timeout: 4_000 });
  });

  test('02.9 back button returns to investigation list', async ({ page }) => {
    await page.locator('a:has-text("Back"), a:has-text("←")').first().click();
    await expect(page).toHaveURL(/\/simulator\/investigation$/);
  });
});
