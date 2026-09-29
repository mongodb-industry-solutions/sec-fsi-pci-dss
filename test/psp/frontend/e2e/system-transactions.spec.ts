/**
 * E2E: Transactions list + detail (FR-v1-04, FR-v4-P3).
 * Routes: /system/transactions, /system/transactions/[txnId].
 * Roles: analysts/auditor; customer is redirected to /system/payment/history.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json, stubPermissions } from './support/auth';

const TXN = {
  cardTransactionInstanceReference: 'txn-9001',
  cardTransactionAmount: { amount: 1299, currency: 'USD' },
  cardTransactionDateTime: '2026-06-01T10:00:00Z',
  cardTransactionStatus: 'authorized',
  cardTransactionType: 'purchase',
  cardTransactionMerchantName: 'TechGadgets Ltd.',
  cardTransactionMerchantCategoryCode: '5999',
  cardTransactionMaskedPanDisplay: '****-****-****-4242',
  cardTransactionChannel: 'online',
  sensitive: null,
};

// v36 (ADR-063): the collection returns normalized movement rows for every kind, so the staff list
// shows card payments AND transfers. `/transactions/all` is gone.
const CARD_ROW = {
  kind: 'card', paymentExecutionInstanceReference: 'txn-9001', direction: 'sent',
  grossAmount: 1299, currency: 'USD', paymentExecutionStatus: 'authorized', paymentExecutionRail: 'card',
  concept: 'TECHGADGETS', beneficiaryName: 'TechGadgets Ltd.', destinationAccountMasked: '****-****-****-4242',
  merchantCategoryCode: '5732', channel: 'online',
  initiatedAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T10:00:00Z', fraudCase: { created: false },
};
const TRANSFER_ROW = {
  kind: 'transfer', paymentExecutionInstanceReference: 'exec-9001', direction: 'sent',
  grossAmount: 1450, currency: 'EUR', paymentExecutionStatus: 'pending', paymentExecutionRail: 'sepa',
  concept: 'Car deposit', beneficiaryName: 'Carlos (savings)', destinationAccountMasked: 'ES12••••5477',
  initiatedAt: '2026-07-08T09:20:00Z', completedAt: null, heldForReview: true,
  fraudCase: { created: true, status: 'open', reference: 'FD-2026-000021' },
};

async function stub(page: Page) {
  // Pages gate on ACL (ADR-030): analysts/auditor need transactions:view.
  await stubPermissions(page, { transactions: ['view'] });
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/transactions**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (/\/transactions\/[^/]+$/.test(p)) return route.fulfill(json(TXN));
    return route.fulfill(json({ results: [CARD_ROW, TRANSFER_ROW], total: 2, page: 1, limit: 20 }));
  });
}

test.describe('FR-v1-04: transactions list', () => {
  test.beforeEach(async ({ page }) => { await stub(page); });

  // L1 / L2 / auditor all see every movement kind in this list, each at their access level.
  for (const role of ['level1_analyst', 'level2_investigator', 'security_auditor'] as const) {
    test(`${role} sees card payments AND transfers in the list`, async ({ page, context }) => {
      await loginAs(context, role);
      await page.goto('/system/transactions');
      await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('TechGadgets Ltd.').first()).toBeVisible({ timeout: 8000 });
      // The non-card movement is listed with its kind, its hold state and its case marker.
      await expect(page.getByText('Carlos (savings)').first()).toBeVisible();
      await expect(page.getByText('Transfer', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('held', { exact: true })).toBeVisible();
      await expect(page.getByText('case', { exact: true })).toBeVisible();
      // Its detail is reachable from the row.
      await expect(page.getByRole('link', { name: /View details/i }).nth(1)).toHaveAttribute('href', '/system/transactions/exec-9001');
    });
  }

  test('customer is redirected away from transactions', async ({ page, context }) => {
    await loginAs(context, 'customer');
    await page.goto('/system/transactions');
    await expect(page).toHaveURL(/\/system\/payment\/history/, { timeout: 8000 });
  });
});

test.describe('FR-v4-P3: transaction detail', () => {
  test('analyst opens a transaction detail (merchant name as heading)', async ({ page, context }) => {
    await stub(page);
    await loginAs(context, 'level2_investigator');
    await page.goto('/system/transactions/txn-9001');
    // Merchant name is the detail heading.
    await expect(page.getByRole('heading', { name: 'TechGadgets Ltd.' })).toBeVisible({ timeout: 15000 });
    // Breadcrumb provides the way back to the transactions list.
    await expect(page.getByRole('link', { name: 'Transactions' }).first()).toBeVisible({ timeout: 8000 });
  });
});
