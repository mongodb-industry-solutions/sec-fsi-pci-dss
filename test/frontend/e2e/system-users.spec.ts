/**
 * E2E: Customer Lookup — QE equality search (FR-v1-04, FR-v2-13).
 * Route: /system/users. Roles: analysts/auditor; customer redirected out.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const CUSTOMER = {
  customerAgreementInstanceReference: 'CA-555',
  customerName: 'Jane Doe',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  customerAgreementEnrollmentDate: '2024-01-15T00:00:00Z',
};

async function stub(page: Page) {
  await page.route('**/api/v1/customer**', (r) => r.fulfill(json(CUSTOMER)));
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
}

test.describe('FR-v1-04: customer lookup', () => {
  test.beforeEach(async ({ page }) => { await stub(page); });

  test('analyst sees the customer lookup (Users) page', async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Search by encrypted field' })).toBeVisible();
  });

  test('a QE equality search returns a customer result', async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await page.goto('/system/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('customer@example.com').fill('jane@example.com');
    await page.getByRole('button', { name: /^Search/ }).first().click();
    await expect(page.getByText('Jane Doe').first()).toBeVisible({ timeout: 8000 });
  });

  test('customer is redirected away from customer lookup', async ({ page, context }) => {
    await loginAs(context, 'customer');
    await page.goto('/system/users');
    await expect(page).toHaveURL(/\/system\/payment\/history/, { timeout: 8000 });
  });
});
