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
    // Use table scope to avoid matching the hidden <option> in the severity filter select
    await expect(page.locator('table').getByText(/HIGH/i).first()).toBeVisible({ timeout: 5_000 });
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
  const MOCK_EVENTS = [
    { actionDateTime: '2026-05-27T12:00:00Z', actionType: 'case_opened', performedByInstanceReference: 'system', performedByRole: 'payment_service', actionDetails: {} },
  ];

  test.beforeEach(async ({ page, context }) => {
    // L2 login so the Customer Profile section (with QE EncryptionBadges) is visible
    await loginAs(context, 'level2_investigator');
    await page.route(`**/api/v1/fraud/${CASE_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CASES.results[0]) });
    });
    // Stub the events endpoint (api.fraud.getEvents → GET /api/v1/fraud/:id/events)
    await page.route(`**/api/v1/fraud/${CASE_ID}/events`, (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caseId: CASE_ID, events: MOCK_EVENTS }) });
    });
    // Customer profile (auto-loaded for L2); return empty object so badges still render
    await page.route('**/api/v1/customer/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.goto(`/system/investigation/${CASE_ID}`);
    await expect(page.locator('text=/FD-2026-002001/').first()).toBeVisible({ timeout: 8_000 });
  });

  test('04.5 customer profile shows QE encryption indicators', async ({ page }) => {
    // EncryptionBadge renders "🔒 <label>" — the Customer Profile section is visible for L2+
    await expect(page.locator('text=/🔒/').first()).toBeVisible();
  });

  test('04.6 activity log shows case_opened entry authored by payment_service', async ({ page }) => {
    // Section heading is "Activity Log" (not "Audit Log")
    await expect(page.locator('text=/Activity Log/').first()).toBeVisible();
    // ACTION_LABELS.case_opened = 'Case opened'
    await expect(page.locator('text=/Case opened/i').first()).toBeVisible();
    // PERFORMER_LABELS.payment_service = 'System - Automated detection'
    await expect(page.locator('text=/System.*Automated|payment_service/').first()).toBeVisible();
  });

  test('04.7 activity log section and heading are present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Activity Log' })).toBeVisible();
  });

  test('04.8 L2 investigator actions section is visible', async ({ page }) => {
    // caseStatus = 'open' (not escalated); L2 Actions section renders with its heading
    await expect(page.locator('text=/L2 Investigator Actions/i').first()).toBeVisible();
  });

  test('04.9 back navigation returns to investigation list', async ({ page }) => {
    await page.locator('a:has-text("Back"), a:has-text("←")').first().click();
    await expect(page).toHaveURL(/\/system\/investigation$/, { timeout: 4_000 });
  });
});
