/**
 * E2E: Merchant lifecycle (FR-v4-P5, FR-v4-P6, BIAN SD-89).
 * Route: /system/merchant (+ /review). Renders different views by role + agreement state.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

function merchantMe(page: Page, status: string | null) {
  return page.route('**/api/v1/merchants/me', (r) => r.fulfill(json(
    status === null
      ? { found: false }
      : { found: true, merchant: {
          merchantAgreementInstanceReference: 'MA-001', merchantName: 'My Coffee Shop Ltd',
          merchantCategoryCode: '5812', merchantCountryCode: 'US', merchantAgreementStatus: status,
          merchantReviewNote: status === 'rejected' ? 'Incomplete KYB documentation.' : undefined,
          recordCreatedDateTime: '2026-06-01T10:00:00Z',
        } },
  )));
}

const MERCHANT_ROW = {
  merchantAgreementInstanceReference: 'MA-777', merchantName: 'Digital Store LLC',
  merchantCategoryCode: '5999', merchantCountryCode: 'US', merchantAgreementStatus: 'under_review',
  merchantRiskCategory: 'low', merchantTier: 'standard',
};

async function merchantList(page: Page) {
  await page.route('**/api/v1/merchants?**', (r) => r.fulfill(json({ results: [MERCHANT_ROW], total: 1 })));
  await page.route('**/api/v1/merchants', (r) => r.fulfill(json({ results: [MERCHANT_ROW], total: 1 })));
}

test.describe('FR-v4-P6: customer onboarding states', () => {
  test('no merchant → application form', async ({ page, context }) => {
    await merchantMe(page, null);
    await loginAs(context, 'customer');
    await page.goto('/system/merchant');
    await expect(page.getByRole('heading', { name: 'Request Merchant Account' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Submit Application/i })).toBeVisible();
  });

  test('under_review → application status view', async ({ page, context }) => {
    await merchantMe(page, 'under_review');
    await loginAs(context, 'customer');
    await page.goto('/system/merchant');
    await expect(page.getByRole('heading', { name: 'Merchant Application' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Under Review/i).first()).toBeVisible();
  });

  test('rejected → not-approved view with officer note', async ({ page, context }) => {
    await merchantMe(page, 'rejected');
    await loginAs(context, 'customer');
    await page.goto('/system/merchant');
    await expect(page.getByRole('heading', { name: 'Application Not Approved' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Incomplete KYB documentation/i)).toBeVisible();
  });
});

test.describe('FR-v4-P5: staff merchant views', () => {
  test('analyst sees the merchant agreements list', async ({ page, context }) => {
    await merchantList(page);
    await loginAs(context, 'security_auditor');
    await page.goto('/system/merchant');
    await expect(page.getByRole('heading', { name: 'Merchant Agreements' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Digital Store LLC').first()).toBeVisible({ timeout: 8000 });
  });

  test('merchant_officer sees the review queue', async ({ page, context }) => {
    await merchantList(page);
    await loginAs(context, 'merchant_officer');
    await page.goto('/system/merchant/review');
    await expect(page.getByRole('heading', { name: 'Merchant Review Queue' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Digital Store LLC').first()).toBeVisible({ timeout: 8000 });
  });
});
