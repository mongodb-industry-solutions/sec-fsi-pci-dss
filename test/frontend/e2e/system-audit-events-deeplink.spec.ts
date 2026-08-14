/**
 * E2E: /system/audit-events reads its filters from the query string, so a record can deep-link
 * into its own audit trail (PCI DSS: the trail must be reachable from the record).
 * Primary roles: security_auditor, manager.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json, stubPermissions } from './support/auth';

const TXN_ID = 'f657a274-53b7-4425-b893-88df21c726c8';

const EVENTS = {
  events: [
    {
      id: 'ev-1', source: 'business', eventDateTime: '2026-07-30T10:00:00Z',
      type: 'card_authorization', action: 'card.authorization.completed', outcome: 'approved',
      entityType: 'transaction', entityId: TXN_ID, performedByRole: 'system',
      bianServiceDomain: 'SD-254 Card Transaction', summary: { transactionId: TXN_ID },
    },
  ],
  total: 1, page: 1, limit: 10, capped: false,
};

async function stub(page: Page, seen: string[]) {
  // The page authorizes on the effective auditEvents:view permission (ADR-030), never on the JWT.
  await stubPermissions(page, { auditEvents: ['view'] }, 'security_auditor');
  await page.route('**/api/v1/events/audit**', (r) => {
    seen.push(r.request().url());
    return r.fulfill(json(EVENTS));
  });
}

test.describe('audit events: query-string filters', () => {
  test('a prefiltered link scopes the stream to one transaction', async ({ page, context }) => {
    const seen: string[] = [];
    await stub(page, seen);
    await loginAs(context, 'security_auditor');

    await page.goto(`/system/audit-events?ref=${TXN_ID}&entityType=transaction`);
    await expect(page.getByRole('heading', { name: 'Audit Events' })).toBeVisible({ timeout: 15000 });

    // The banner states what the stream is scoped to, and the filter input is prefilled.
    await expect(page.getByText('Scoped to events referencing')).toBeVisible();
    await expect(page.locator(`input[value="${TXN_ID}"]`)).toBeVisible();

    // The request carried the filters through to the API, not just the UI.
    await expect.poll(() => seen.some((u) => u.includes(`ref=${TXN_ID}`) && u.includes('entityType=transaction')))
      .toBe(true);
  });

  test('clearing the scope filter drops it from the URL', async ({ page, context }) => {
    const seen: string[] = [];
    await stub(page, seen);
    await loginAs(context, 'security_auditor');

    await page.goto(`/system/audit-events?ref=${TXN_ID}`);
    await expect(page.getByText('Scoped to events referencing')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Remove this filter' }).click();
    await expect(page.getByText('Scoped to events referencing')).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('ref')).toBeNull();
  });

  test('a relative preset narrows the window and survives in the URL', async ({ page, context }) => {
    const seen: string[] = [];
    await stub(page, seen);
    await loginAs(context, 'security_auditor');

    await page.goto('/system/audit-events');
    await expect(page.getByRole('heading', { name: 'Audit Events' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Last 3 days' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBeNull();
    await expect.poll(() => seen.some((u) => u.includes('from='))).toBe(true);

    await page.getByRole('button', { name: 'All time' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBeNull();
    // No preset may look applied once the window is cleared.
    await expect(page.getByRole('button', { name: 'Last 3 days' })).not.toHaveClass(/bg-\[#001E2B\]/);
  });
});
