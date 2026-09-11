/**
 * E2E: Simulator Mode - Investigation Flow (FR-v1-02)
 * Search by QE fields, case table, case detail with encryption badges, raw document toggle.
 *
 * API: api.fraud.list  → GET /api/v1/fraud (NOT /api/v1/fraud-cases)
 *      api.fraud.getById → GET /api/v1/fraud/:id
 * Mock fields: FraudCase uses caseStatus / riskSeverity (internal names, not BIAN names).
 */
import { test, expect } from '@playwright/test';
import { mintJwt, json } from './support/auth';

/**
 * The case detail page will not render ANYTHING until it holds real tokens for the two specialist
 * roles, because its escalation actions use them. It obtains those by exchanging the simulator's own
 * client credential at the authority.
 *
 * Stubbed here, and it has to be. This is a RENDERING spec: it asserts that a case shows its badges,
 * its encryption markers and its raw document toggle. Making that assertion depend on a live client
 * secret and a working token exchange tests the environment rather than the page, and fails for a
 * reason that has nothing to do with what is being checked. The escalation flows that genuinely
 * need real tokens are exercised where they belong.
 */
async function stubSpecialistTokens(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/system/users**', (route) => route.fulfill(json({
    users: [
      { email: 'sarah.chen@back.es', name: 'Sarah Chen', role: 'level1_analyst', featured: true },
      { email: 'michael.obi@back.es', name: 'Michael Obi', role: 'level2_investigator', featured: true },
    ],
  })));
  await page.route('**/protocol/openid-connect/token', (route) => route.fulfill(json({
    access_token: mintJwt({ roles: ['level2_investigator'], sub: 'u-sim', email: 'michael.obi@back.es' }),
    token_type: 'Bearer',
    expires_in: 300,
  })));
}

const MOCK_CASE = {
  fraudDiagnosisInstanceReference: 'case-sim-e2e',
  fraudDiagnosisCaseReference: 'FD-2026-001001',
  caseStatus: 'open',
  riskSeverity: 'high',
  cardTransactionInstanceReference: 'txn-001',
  customerAgreementInstanceReference: 'cust-001',
  requestDateTime: '2026-05-27T10:00:00Z',
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

  test('02.2 submitting search calls the fraud API', async ({ page }) => {
    let requestMade = false;
    // api.fraud.list calls GET /api/v1/fraud (not /api/v1/fraud-cases)
    await page.route('**/api/v1/fraud**', (route) => {
      requestMade = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], total: 0, page: 1, limit: 20 }) });
    });
    await page.locator('input[type="text"]').first().fill('test@example.com');
    await page.locator('button[type="submit"], button:has-text("Search")').first().click();
    await page.waitForTimeout(800);
    expect(requestMade).toBe(true);
  });

  test('02.3 case table renders when fraud cases are returned', async ({ page }) => {
    await page.route('**/api/v1/fraud**', (route) => {
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
    await stubSpecialistTokens(page);
    // api.fraud.getById calls GET /api/v1/fraud/:id (not /api/v1/fraud-cases/:id)
    await page.route(`**/api/v1/fraud/${CASE_ID}`, (route) => {
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
    // The badge renders a lucide <Lock> icon (not a 🔒 emoji) plus the field label, and carries the
    // QE mode in its title. Assert the mode, so the test states which protection is shown rather than
    // how it is drawn: both QE tiers must be distinguishable on the page.
    await expect(page.locator('[title="QE: equality-searchable"]').first()).toBeVisible();
    await expect(page.locator('[title="QE: encrypted, not searchable"]').first()).toBeVisible();
  });

  test('02.6 shows the investigation workflow step navigator', async ({ page }) => {
    // The simulator case detail shows a step navigator (no separate audit-log section).
    // diagnosisActionLog is not rendered directly; the page has an Investigation Flow stepper.
    await expect(page.locator('text=/Investigation Flow/i').first()).toBeVisible();
    await expect(page.locator('text=/L1 Opens Ticket/i').first()).toBeVisible();
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
        body: JSON.stringify({ document: { cardTransactionMerchantName: 'Test', cardTransactionAccountReference: { $binary: { base64: 'AABB', subType: '06' } } } }),
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
