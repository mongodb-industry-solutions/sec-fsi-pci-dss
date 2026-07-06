/**
 * E2E: Transactions list + detail (FR-v1-04, FR-v4-P3).
 * Routes: /system/transactions, /system/transactions/[txnId].
 * Roles: analysts/auditor; customer is redirected to /system/payment/history.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

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

async function stub(page: Page) {
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/transactions**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/all')) return route.fulfill(json({ results: [TXN], total: 1, page: 1, limit: 20 }));
    if (/\/transactions\/[^/]+$/.test(p)) return route.fulfill(json(TXN));
    return route.fulfill(json({ results: [TXN], total: 1, page: 1, limit: 20 }));
  });
}

test.describe('FR-v1-04: transactions list', () => {
  test.beforeEach(async ({ page }) => { await stub(page); });

  test('analyst sees the Transactions list with a row', async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/transactions');
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('TechGadgets Ltd.').first()).toBeVisible({ timeout: 8000 });
  });

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
    await expect(page.getByText('TechGadgets Ltd.').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Back to transactions/i)).toBeVisible({ timeout: 8000 });
  });
});
