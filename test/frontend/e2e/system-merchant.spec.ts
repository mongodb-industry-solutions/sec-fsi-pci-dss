/**
 * E2E: Merchant lifecycle (FR-v4-P5, FR-v4-P6).
 * Route: /system/merchant (+ /review). Renders different views by role + agreement state.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

// A customer's merchant portfolio comes from GET /api/v1/merchants (list); the
// /system/merchant root shows the registration form when the list is empty.
function customerMerchantList(page: Page, merchants: unknown[]) {
  const body = json({ results: merchants, total: merchants.length });
  // Anchor to the LIST endpoint only (optional query string). A glob like `**/api/v1/merchants?**`
  // would also match `/api/v1/merchants/:id` (`?` is a single-char wildcard), stubbing the wrong route.
  return page.route(/\/api\/v1\/merchants(\?.*)?$/, (r) => r.fulfill(body));
}

// Onboarding status (under_review / rejected) is shown on the merchant overview
// route, which loads the merchant via GET /api/v1/merchants/:id.
function merchantById(page: Page, status: string) {
  return page.route('**/api/v1/merchants/MA-001', (r) => r.fulfill(json({
    merchantAgreementInstanceReference: 'MA-001', merchantName: 'My Coffee Shop Ltd',
    merchantCategoryCode: '5812', merchantCountryCode: 'US', merchantAgreementStatus: status,
    merchantReviewNote: status === 'rejected' ? 'Incomplete KYB documentation.' : undefined,
    recordCreatedDateTime: '2026-06-01T10:00:00Z',
  })));
}

const MERCHANT_ROW = {
  merchantAgreementInstanceReference: 'MA-777', merchantName: 'Digital Store LLC',
  merchantCategoryCode: '5999', merchantCountryCode: 'US', merchantAgreementStatus: 'under_review',
  merchantRiskCategory: 'low', merchantTier: 'standard',
};

async function merchantList(page: Page) {
  // Anchor to the LIST endpoint only (optional query string) so `/api/v1/merchants/:id` is not caught.
  await page.route(/\/api\/v1\/merchants(\?.*)?$/, (r) => r.fulfill(json({ results: [MERCHANT_ROW], total: 1 })));
}

test.describe('FR-v4-P6: customer onboarding states', () => {
  test('no merchant → registration form', async ({ page, context }) => {
    await customerMerchantList(page, []);
    await loginAs(context, 'customer');
    await page.goto('/system/merchant');
    await expect(page.getByRole('heading', { name: 'Register Merchant' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Submit Application/i })).toBeVisible();
  });

  test('under_review → application status view', async ({ page, context }) => {
    await merchantById(page, 'under_review');
    await loginAs(context, 'customer');
    await page.goto('/system/merchant/MA-001/overview');
    // Application status card + review timeline (not the analytics dashboard).
    await expect(page.getByText(/My Coffee Shop Ltd is under review/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Application Submitted')).toBeVisible();
  });

  test('rejected → not-approved view with officer note', async ({ page, context }) => {
    await merchantById(page, 'rejected');
    await loginAs(context, 'customer');
    await page.goto('/system/merchant/MA-001/overview');
    await expect(page.getByText(/My Coffee Shop Ltd was not approved/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Incomplete KYB documentation/i).first()).toBeVisible();
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
