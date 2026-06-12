/**
 * E2E: Customer payment (FR-v1-01/03) — new-payment wizard + history.
 * Routes: /system/payment, /system/payment/history.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const PICKER = { total: 1, results: [
  { merchantAgreementInstanceReference: 'MA-1', merchantName: 'TechGadgets Ltd.', merchantCategoryCode: '5999', merchantRiskCategory: 'low' },
] };

async function stubPicker(page: Page) {
  await page.route('**/api/v1/merchants/picker**', (r) => r.fulfill(json(PICKER)));
}

test.describe('FR-v1-01/03: new payment wizard', () => {
  test.beforeEach(async ({ page, context }) => { await stubPicker(page); await loginAs(context, 'customer'); });

  test('renders step 1 with card presets', async ({ page }) => {
    await page.goto('/system/payment');
    await expect(page.getByText('Visa Demo 4291').first()).toBeVisible({ timeout: 15000 });
  });

  test('completes the 3-step flow to a confirmation', async ({ page }) => {
    await page.route('**/api/v1/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ cardTransactionInstanceReference: 'txn-ok-1', cardTransactionStatus: 'authorized', fraudCaseCreated: false }, 201))
      : route.continue());
    await page.goto('/system/payment');
    await page.getByText('Visa Demo 4291').first().click();
    await page.getByText('$120.00').first().click();
    await page.getByRole('button', { name: 'TechGadgets Ltd.' }).first().click();
    await page.getByRole('button', { name: /^Next/ }).click();
    await page.getByRole('button', { name: /Confirm Payment/i }).click();
    await expect(page.getByText(/Payment Confirmed/i)).toBeVisible({ timeout: 8000 });
  });

  test('a fraud-flagged payment surfaces the fraud alert', async ({ page }) => {
    await page.route('**/api/v1/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ cardTransactionInstanceReference: 'txn-fraud-1', cardTransactionStatus: 'authorized', fraudCaseCreated: true, fraudDiagnosisInstanceReference: 'FD-9' }, 201))
      : route.continue());
    await page.goto('/system/payment');
    await page.getByText('Visa Demo 4291').first().click();
    await page.getByText('$120.00').first().click();
    await page.getByRole('button', { name: 'TechGadgets Ltd.' }).first().click();
    await page.getByRole('button', { name: /^Next/ }).click();
    await page.getByRole('button', { name: /Confirm Payment/i }).click();
    await expect(page.getByText(/fraud|review|investigation/i).first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('FR-v1-01: payment history', () => {
  test('customer sees their transaction history', async ({ page, context }) => {
    await page.route('**/api/v1/transactions/all**', (r) => r.fulfill(json({ page: 1, limit: 100, total: 1, results: [
      { cardTransactionInstanceReference: 'txn-h1', cardTransactionAmount: { amount: 42.5, currency: 'USD' }, cardTransactionDateTime: '2026-06-01T10:00:00Z', cardTransactionStatus: 'authorized', cardTransactionMerchantName: 'TechGadgets Ltd.', cardTransactionMaskedPanDisplay: '****-****-****-4242', cardTransactionChannel: 'online' },
    ] })));
    await loginAs(context, 'customer');
    await page.goto('/system/payment/history');
    await expect(page.getByRole('heading', { name: 'My Transactions' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('TechGadgets Ltd.').first()).toBeVisible({ timeout: 8000 });
  });
});
