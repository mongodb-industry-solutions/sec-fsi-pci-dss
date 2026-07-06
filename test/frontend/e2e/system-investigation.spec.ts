/**
 * E2E: Fraud investigation dashboard + case detail (FR-v1-02/04, FR-v2-11).
 * Routes: /system/investigation, /system/investigation/[caseId].
 * Roles: level1_analyst, level2_investigator, security_auditor (customer is redirected out).
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const CASE = {
  fraudDiagnosisInstanceReference: 'FD-0001',
  fraudDiagnosisCaseReference: 'CASE-2026-0001',
  caseStatus: 'open',
  fraudDiagnosisCaseStatus: 'open',
  riskSeverity: 'high',
  cardTransactionInstanceReference: 'txn-1',
  customerAgreementInstanceReference: 'CA-1',
  transactionSnapshot: {
    cardTransactionAmount: { amount: 1299, currency: 'USD' },
    cardTransactionMerchantName: 'TechGadgets Ltd.',
    cardTransactionDateTime: '2026-06-01T10:00:00Z',
    cardTransactionStatus: 'authorized',
    cardTransactionMaskedPanDisplay: '****-****-****-4242',
  },
  fraudDiagnosisAssessment: { riskIndicators: ['velocity'], fraudDiagnosisScore: 82 },
  fraudDiagnosisCaseNotes: null,
  fraudDiagnosisResolutionRecord: null,
  escalationAcceptedAt: null,
  diagnosisActionLog: [],
};

async function stubFraud(page: Page) {
  await page.route('**/api/v1/fraud/stats**', (r) => r.fulfill(json({ total: 1, byStatus: [], bySeverity: [] })));
  await page.route('**/api/v1/customer**', (r) => r.fulfill(json({ customerAgreementInstanceReference: 'CA-1', customerName: 'Jane Doe', customerSegment: 'retail', customerAgreementStatus: 'active' })));
  await page.route('**/api/v1/fraud**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/events')) return route.fulfill(json({ caseId: 'FD-0001', events: [{ actionDateTime: '2026-06-01T10:00:00Z', actionType: 'case_opened', performedByRole: 'system', performedByInstanceReference: 'payment_service', actionDetails: {}, fraudDiagnosisInstanceReference: 'FD-0001' }] }));
    if (p.endsWith('/notes')) return route.fulfill(json({ notes: [] }));
    if (p.includes('/hrpc/')) return route.fulfill(json({ match: false }));
    if (/\/fraud\/[^/]+$/.test(p)) return route.fulfill(json(CASE));
    return route.fulfill(json({ results: [CASE], total: 1, page: 1, limit: 20 }));
  });
}

test.describe('FR-v1-04: case dashboard', () => {
  test.beforeEach(async ({ page }) => { await stubFraud(page); });

  for (const role of ['level1_analyst', 'level2_investigator', 'security_auditor'] as const) {
    test(`${role} sees the Case Dashboard with a case row`, async ({ page, context }) => {
      await loginAs(context, role);
      await page.goto('/system/investigation');
      await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('CASE-2026-0001').first()).toBeVisible({ timeout: 8000 });
    });
  }

  test('customer is redirected away from the investigation dashboard', async ({ page, context }) => {
    await stubFraud(page);
    await loginAs(context, 'customer');
    await page.goto('/system/investigation');
    await expect(page).toHaveURL(/\/system\/payment\/history/, { timeout: 8000 });
  });
});

test.describe('FR-v2-11: case detail', () => {
  test('L1 opens a case detail and sees the escalate action', async ({ page, context }) => {
    await stubFraud(page);
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/investigation/FD-0001');
    await expect(page.getByText('CASE-2026-0001').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Escalate to Level 2/i })).toBeVisible({ timeout: 8000 });
  });

  test('L2 sees the approve-escalation action on an escalated case', async ({ page, context }) => {
    await page.route('**/api/v1/fraud/stats**', (r) => r.fulfill(json({ total: 1, byStatus: [], bySeverity: [] })));
    await page.route('**/api/v1/customer**', (r) => r.fulfill(json({ customerName: 'Jane Doe' })));
    await page.route('**/api/v1/fraud**', (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/events')) return route.fulfill(json({ caseId: 'FD-0001', events: [] }));
      if (p.endsWith('/notes')) return route.fulfill(json({ notes: [] }));
      if (p.includes('/hrpc/')) return route.fulfill(json({ match: false }));
      if (/\/fraud\/[^/]+$/.test(p)) return route.fulfill(json({ ...CASE, caseStatus: 'escalated', fraudDiagnosisCaseStatus: 'escalated', escalationAcceptedAt: null }));
      return route.fulfill(json({ results: [CASE], total: 1, page: 1, limit: 20 }));
    });
    await loginAs(context, 'level2_investigator');
    await page.goto('/system/investigation/FD-0001');
    await expect(page.getByText('CASE-2026-0001').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Approve Escalation/i })).toBeVisible({ timeout: 8000 });
  });
});
