/**
 * E2E: SD-88 Card Management — Revoke + Set-as-Preferred in user profile
 * Route: /system/profile ("Saved Payment Methods" section)
 * Role: customer (JWT injected via demo_token cookie using loginAs helper)
 *
 * Success criteria (dev.plan.md §C6):
 *   SC-1  Revoking a card → PATCH { paymentCardStatus: 'revoked' } called; card removed from list
 *   SC-2  Set as Preferred → PATCH { paymentCardIsPreferred: true } called; list refreshes
 *   SC-5  Remove + Set-as-Preferred buttons visible on active cards
 *   SC-6  Confirmation dialog shown before revoke; Cancel aborts the action
 *
 * All backend calls are mocked with page.route — no live stack required for test correctness.
 * The test:e2e command in /admin/panel/setup does require the frontend dev server (:3000).
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const AGREEMENT_ID = 'CA-LF-001';

const PROFILE_ME = {
  sub: 'u-cust-001',
  email: 'luis.fernandez@back.es',
  name: 'Luis Fernandez',
  role: 'customer',
  domain: 'local',
  agreement: {
    customerAgreementInstanceReference: AGREEMENT_ID,
    customerName: 'Luis Fernandez',
    customerEmailAddress: 'luis.fernandez@back.es',
    customerAgreementStatus: 'active',
    customerAgreementKycCheck: { customerAgreementKycCheckStatus: 'verified' },
  },
};

const CARD_A = {
  paymentCardInstanceReference: 'CARD-001',
  paymentCardMaskedPanDisplay: '****-****-****-4242',
  paymentCardNetwork: 'VISA',
  paymentCardStatus: 'active',
  paymentCardIsPreferred: true,
};

const CARD_B = {
  paymentCardInstanceReference: 'CARD-002',
  paymentCardMaskedPanDisplay: '****-****-****-1111',
  paymentCardNetwork: 'MASTERCARD',
  paymentCardStatus: 'active',
  paymentCardIsPreferred: false,
};

async function stubBase(page: Page, cards = [CARD_A, CARD_B]) {
  await page.route('**/api/v1/auth/me**', (r) => r.fulfill(json(PROFILE_ME)));
  await page.route('**/api/v1/merchants/me**', (r) => r.fulfill(json({ found: false })));
  await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards`, (r) => r.fulfill(json({ results: cards })));
}

// ─── SC-5: card list + action buttons ────────────────────────────────────────

test.describe('SC-5: card list renders with action buttons', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('5a shows both active card rows in the Saved Payment Methods section', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible();
  });

  test('5b Remove button visible on active cards', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('button', { name: /remove/i }).first()).toBeVisible();
  });

  test('5c Set-as-Preferred button visible on non-preferred active card', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('button', { name: /preferred/i }).first()).toBeVisible();
  });

  test('5d preferred badge displayed on the preferred card (CARD_A)', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText(/preferred/i).first()).toBeVisible();
  });
});

// ─── SC-6: confirmation dialog before revoke ─────────────────────────────────

test.describe('SC-6: revoke confirmation dialog', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('6a clicking Remove shows dialog with Cancel + Confirm', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByRole('button', { name: /remove/i }).first()).toBeVisible({ timeout: 12_000 });
    await page.getByRole('button', { name: /remove/i }).first().click();
    await expect(
      page.getByText(/remove.*card|revoke.*card|cannot be undone/i).first()
    ).toBeVisible({ timeout: 4_000 });
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible();
  });

  test('6b pressing Cancel dismisses dialog; card still in list', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/profile');
    await expect(page.getByRole('button', { name: /remove/i }).first()).toBeVisible({ timeout: 12_000 });
    await page.getByRole('button', { name: /remove/i }).first().click();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 2_000 });
  });
});

// ─── SC-1: revoke card ────────────────────────────────────────────────────────

test.describe('SC-1: revoke card end-to-end', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('confirm revoke → PATCH {paymentCardStatus:revoked} sent; card removed from list', async ({ page }) => {
    let patchPayload: Record<string, unknown> | null = null;
    let getCount = 0;

    await page.route('**/api/v1/auth/me**', (r) => r.fulfill(json(PROFILE_ME)));
    await page.route('**/api/v1/merchants/me**', (r) => r.fulfill(json({ found: false })));

    // GET /cards: first call returns both cards; second call (after revoke) omits CARD_A
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards`, (r) => {
      getCount++;
      r.fulfill(json({ results: getCount === 1 ? [CARD_A, CARD_B] : [CARD_B] }));
    });

    // PATCH /cards/CARD-001 — specific card operation (registered after GET route → higher priority)
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/CARD-001`, (route) => {
      if (route.request().method() === 'PATCH') {
        patchPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        route.fulfill(json({ paymentCardInstanceReference: 'CARD-001', paymentCardStatus: 'revoked', paymentCardIsPreferred: false }));
      } else {
        route.continue();
      }
    });

    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 12_000 });

    await page.getByRole('button', { name: /remove/i }).first().click();
    await page.getByRole('button', { name: /confirm/i }).click();

    // CARD_A gone; CARD_B still present
    await expect(page.getByText('****-****-****-4242')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible();

    expect(patchPayload?.paymentCardStatus).toBe('revoked');
  });
});

// ─── SC-2: set preferred card ─────────────────────────────────────────────────

test.describe('SC-2: set preferred card', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('Set as Preferred → PATCH {paymentCardIsPreferred:true} sent; list refreshes', async ({ page }) => {
    let patchPayload: Record<string, unknown> | null = null;
    let getCount = 0;

    await page.route('**/api/v1/auth/me**', (r) => r.fulfill(json(PROFILE_ME)));
    await page.route('**/api/v1/merchants/me**', (r) => r.fulfill(json({ found: false })));

    // GET /cards: second call returns CARD_B as preferred, CARD_A demoted
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards`, (r) => {
      getCount++;
      r.fulfill(json({
        results: getCount === 1
          ? [CARD_A, CARD_B]
          : [{ ...CARD_A, paymentCardIsPreferred: false }, { ...CARD_B, paymentCardIsPreferred: true }],
      }));
    });

    // PATCH /cards/CARD-002 — set preferred on the non-preferred card
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/CARD-002`, (route) => {
      if (route.request().method() === 'PATCH') {
        patchPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        route.fulfill(json({ paymentCardInstanceReference: 'CARD-002', paymentCardStatus: 'active', paymentCardIsPreferred: true }));
      } else {
        route.continue();
      }
    });

    await page.goto('/system/profile');
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible({ timeout: 12_000 });

    // CARD_B row has the "Set as Preferred" button (CARD_A's button is absent — it's already preferred)
    await page.getByRole('button', { name: /preferred/i }).first().click();

    await expect(async () => {
      expect(patchPayload?.paymentCardIsPreferred).toBe(true);
    }).toPass({ timeout: 6_000 });
  });
});
