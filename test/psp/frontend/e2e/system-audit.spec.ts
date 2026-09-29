/**
 * E2E: Audit Log viewer (FR-v2-12, PCI DSS).
 * Route: /system/audit. Primary role: security_auditor.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const EVENTS = {
  events: [
    { actionDateTime: '2026-06-01T10:00:00Z', actionType: 'case_opened', performedByRole: 'system', performedByInstanceReference: 'payment_service', actionDetails: { note: 'auto' }, fraudDiagnosisInstanceReference: 'FD-0001', fraudDiagnosisCaseReference: 'CASE-2026-0001' },
    { actionDateTime: '2026-06-01T11:00:00Z', actionType: 'escalated', performedByRole: 'level1_analyst', performedByInstanceReference: 'u-l1-001', actionDetails: {}, fraudDiagnosisInstanceReference: 'FD-0001', fraudDiagnosisCaseReference: 'CASE-2026-0001' },
  ],
  total: 2, page: 1, limit: 20,
};

async function stub(page: Page) {
  // Register broad first, specific LAST: Playwright runs the most-recently-added
  // matching handler first, so /audit-events must be registered after /fraud**.
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/fraud/audit-events**', (r) => r.fulfill(json(EVENTS)));
}

test.describe('FR-v2-12: audit log', () => {
  test.beforeEach(async ({ page }) => { await stub(page); });

  test('auditor sees the Audit Log with event rows', async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await page.goto('/system/audit');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('CASE-2026-0001').first()).toBeVisible({ timeout: 8000 });
  });

  test('the role filter is present for narrowing the trail', async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await page.goto('/system/audit');
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('select').first()).toBeVisible();
  });
});
