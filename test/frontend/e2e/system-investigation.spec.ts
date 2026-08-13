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
    if (p.endsWith('/questions')) return route.fulfill(json({ questions: [] }));
    if (p.endsWith('/enrichment')) return route.fulfill(json({ caseId: 'FD-0001', asOf: '2026-06-01T10:00:00Z' }));
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
      if (p.endsWith('/questions')) return route.fulfill(json({ questions: [] }));
      if (p.endsWith('/enrichment')) return route.fulfill(json({ caseId: 'FD-0001', asOf: '2026-06-01T10:00:00Z' }));
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

// A non-card case (transfer / RTP) must show its own counterparty, never an empty merchant panel.
test.describe('case detail for a non-card movement', () => {
  const TRANSFER_CASE = {
    ...CASE,
    transactionKind: 'p2p',
    paymentExecutionInstanceReference: 'exec-1',
    fraudDiagnosisAssessment: { riskIndicators: ['fds.high.risk', 'aml.alert: medium'], fraudDiagnosisScore: 78 },
    transactionSnapshot: {
      cardTransactionAmount: { amount: 1450, currency: 'EUR' },
      cardTransactionMerchantName: 'Transfer to Carlos (savings)',
      cardTransactionDateTime: '2026-07-08T09:20:00Z',
      cardTransactionStatus: 'pending',
      cardTransactionMaskedPanDisplay: 'Bank transfer',
    },
  };
  const ENRICHMENT = {
    caseId: 'FD-0001', asOf: '2026-07-08T09:30:00Z', transactionKind: 'p2p',
    operation: {
      transactionId: 'exec-1', kind: 'p2p', type: 'transfer', status: 'pending', channel: 'transfer',
      rail: 'sepa', heldForReview: true, amount: { amount: 1450, currency: 'EUR' },
      dateTime: '2026-07-08T09:20:00Z', description: 'Car deposit',
    },
    counterparty: {
      kind: 'beneficiary', label: 'Carlos (savings)', accountMasked: '+34 6** *** 789',
      countryCode: 'ES', partyReference: 'party-2', arrangementReference: 'cab-1', accountReference: 'acc-dest',
      lookupType: 'phone', status: 'active', registeredAt: '2026-05-01T00:00:00Z',
      ownerParty: { reference: 'party-2', name: 'Carlos Ruiz', type: 'individual', customerAgreementInstanceReference: 'agr-2' },
      account: {
        reference: 'acc-dest', alias: 'Main', bankName: 'Banco Uno', holderName: 'Carlos Ruiz',
        currency: 'EUR', countryCode: 'ES', type: 'internal_ledger', status: 'active',
        partyReference: 'party-2', balance: { available: 300, pending: 0 },
      },
    },
    sourceAccount: {
      reference: 'acc-sender', alias: 'Payroll', bankName: 'Banco Dos', holderName: 'Luis Fernandez',
      currency: 'EUR', countryCode: 'ES', type: 'internal_ledger', status: 'active',
      partyReference: 'party-1', balance: { available: 500, pending: 1450 },
    },
    sdf: { score: 78, scorePending: false, indicators: ['fds.high.risk'], conclusion: null, events: [] },
    hrp: { available: false }, kyc: null, kyb: null,
    references: { caseId: 'FD-0001', transactionId: 'exec-1', customerId: 'CA-1', merchantId: null, accountRef: null, executionRef: 'exec-1', paymentRequestRef: null },
  };

  test('L1 sees the beneficiary and the hold, and no merchant panel', async ({ page, context }) => {
    await page.route('**/api/v1/fraud/stats**', (r) => r.fulfill(json({ total: 1, byStatus: [], bySeverity: [] })));
    await page.route('**/api/v1/customer**', (r) => r.fulfill(json({ customerName: 'Jane Doe' })));
    await page.route('**/api/v1/fraud**', (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/events')) return route.fulfill(json({ caseId: 'FD-0001', events: [] }));
      if (p.endsWith('/notes')) return route.fulfill(json({ notes: [] }));
      if (p.endsWith('/questions')) return route.fulfill(json({ questions: [] }));
      if (p.endsWith('/enrichment')) return route.fulfill(json(ENRICHMENT));
      if (p.includes('/hrpc/')) return route.fulfill(json({ match: false }));
      if (/\/fraud\/[^/]+$/.test(p)) return route.fulfill(json(TRANSFER_CASE));
      return route.fulfill(json({ results: [TRANSFER_CASE], total: 1, page: 1, limit: 20 }));
    });
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/investigation/FD-0001');
    await expect(page.getByText('CASE-2026-0001').first()).toBeVisible({ timeout: 15000 });

    // Movement type + hold state on the operation panel.
    await expect(page.getByText('Transfer to contact')).toBeVisible();
    await expect(page.getByText(/Funds held, not delivered/i)).toBeVisible();
    await expect(page.getByText('SEPA')).toBeVisible();

    // Counterparty panel with the PSP-owned beneficiary data, masked.
    await expect(page.getByRole('heading', { name: 'Beneficiary' })).toBeVisible();
    await expect(page.getByText('Carlos (savings)').first()).toBeVisible();
    await expect(page.getByText('+34 6** *** 789')).toBeVisible();
    await expect(page.getByText(/Saved beneficiary since/i)).toBeVisible();

    // The merchant/KYB panel is gone: there is no acquired merchant in a transfer.
    await expect(page.getByRole('heading', { name: /^Merchant/ })).toHaveCount(0);
    await expect(page.getByText(/not acquired by this PSP/i)).toHaveCount(0);

    // The reference is text, not a link into the card-transaction route (which would 404 / 403).
    await expect(page.getByText('Operation ID:')).toBeVisible();
    await expect(page.getByRole('link', { name: 'exec-1' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open transaction/i })).toHaveCount(0);
    // The header names the destination, never a merchant.
    await expect(page.getByText('Destination:').first()).toBeVisible();
    await expect(page.getByText('Merchant:')).toHaveCount(0);

    // The identity behind the beneficiary and both accounts: what a real investigation needs.
    await expect(page.getByText('Carlos Ruiz').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Open owner record/i })).toHaveAttribute('href', /\/system\/users\/agr-2/);
    await expect(page.getByText('Receiving account')).toBeVisible();
    await expect(page.getByText('Banco Uno')).toBeVisible();
    await expect(page.getByText('Source account')).toBeVisible();
    await expect(page.getByText('On hold:')).toBeVisible();
    // The account drill-down needs accounts:view, which L1 does not hold.
    await expect(page.getByRole('link', { name: /Open account/i })).toHaveCount(0);

    // The plain-language indicators, not the raw gate ids.
    await expect(page.getByText(/Fraud risk detected/i).first()).toBeVisible();
    await expect(page.getByText(/Money-laundering alert \(medium severity\)/i).first()).toBeVisible();
    await expect(page.getByText('fds.high.risk')).toHaveCount(0);
  });
});
