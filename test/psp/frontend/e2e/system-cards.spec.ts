/**
 * E2E: Card Management, saved-card list, detail actions (remove + deactivate)
 *
 * The card-management UI was redesigned: management moved OFF /system/profile onto a
 * dedicated route. The searchable list lives at /system/cards (SavedCardsPanel) and
 * shows masked PANs + a preferred (star) badge; each row navigates to the detail page
 * /system/cards/[cardId], where the lifecycle actions now live:
 *   - "Remove card"          → DELETE /cards/{id}      (confirm dialog "Remove this card?")
 *   - "Deactivate"/"Reactivate" → PATCH /cards/{id}/status { active } (confirm on deactivate)
 * Alias/note edit → PATCH /cards/{id}. Actions use the programmatic useConfirm() modal
 * from ConfirmProvider (title / message / Cancel + confirmLabel), not inline buttons.
 *
 * Success criteria (mapped to the current UI):
 *   SC-5  List renders active cards with masked PAN + preferred badge; rows open detail.
 *   SC-6  Removing a card shows a confirm dialog (Cancel + "Remove card"); Cancel aborts.
 *   SC-1  Confirming remove → DELETE /cards/{id} sent; user returned to the card list.
 *   SC-2  Deactivating a card → confirm dialog, then PATCH /cards/{id}/status { active:false }.
 *
 * NOTE on divergence from the original spec: the redesigned UI removes a card via DELETE
 * (soft-delete, server-side audit) rather than PATCH {paymentCardStatus:'revoked'}, and there
 * is no "set as preferred" toggle for an already-saved card (preferred is only chosen when a
 * card is first added). The old SC-1 "PATCH revoked" and SC-2 "PATCH preferred" flows no longer
 * exist in the product, so these tests assert the real replacement flows (DELETE + status PATCH).
 *
 * All backend calls are mocked with page.route, no live stack required for test correctness.
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

// Full detail record for the detail page (no card token / funding account → no extra fetches).
const CARD_B_DETAIL = {
  ...CARD_B,
  paymentCardExpirationDate: '12/29',
  paymentCardAlias: '',
  paymentCardCustomerNote: '',
};

/** Stub auth + merchants + the card LIST endpoint (used by /system/cards). */
async function stubBase(page: Page, cards = [CARD_A, CARD_B]) {
  await page.route('**/api/v1/auth/me**', (r) => r.fulfill(json(PROFILE_ME)));
  await page.route('**/api/v1/merchants/me**', (r) => r.fulfill(json({ found: false })));
  await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards`, (r) => r.fulfill(json({ results: cards })));
}

/** Stub the single-card GET (getCardById) for the detail page. */
async function stubCardDetail(page: Page, detail = CARD_B_DETAIL) {
  await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/${detail.paymentCardInstanceReference}`, (route) => {
    if (route.request().method() === 'GET') route.fulfill(json(detail));
    else route.continue();
  });
}

// ─── SC-5: card list renders + navigation to detail ──────────────────────────

test.describe('SC-5: saved-card list', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('5a shows both active card rows in the Saved Payment Methods list', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/cards');
    await expect(page.getByRole('heading', { name: /saved payment methods/i })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible();
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible();
  });

  test('5b preferred badge (star) displayed on the preferred card row', async ({ page }) => {
    await stubBase(page);
    await page.goto('/system/cards');
    await expect(page.getByText('****-****-****-4242').first()).toBeVisible({ timeout: 12_000 });
    // The preferred card (CARD_A) row carries the "Default card" star; the non-preferred one does not.
    await expect(page.getByTitle('Default card')).toHaveCount(1);
  });

  test('5c clicking a card row navigates to its detail page with lifecycle actions', async ({ page }) => {
    await stubBase(page);
    await stubCardDetail(page);
    await page.goto('/system/cards');
    await expect(page.getByText('****-****-****-1111').first()).toBeVisible({ timeout: 12_000 });

    await page.getByText('****-****-****-1111').first().click();
    await expect(page).toHaveURL(/\/system\/cards\/CARD-002/, { timeout: 8_000 });
    await expect(page.getByRole('button', { name: /remove card/i })).toBeVisible();
  });

  test('5d detail page exposes Remove + Deactivate actions on an active card', async ({ page }) => {
    await stubBase(page);
    await stubCardDetail(page);
    await page.goto('/system/cards/CARD-002');
    await expect(page.getByRole('button', { name: /remove card/i })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('button', { name: /deactivate/i })).toBeVisible();
  });
});

// ─── SC-6: confirmation dialog before remove ─────────────────────────────────

test.describe('SC-6: remove confirmation dialog', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('6a clicking Remove card shows dialog "Remove this card?" with Cancel + Remove card', async ({ page }) => {
    await stubBase(page);
    await stubCardDetail(page);
    await page.goto('/system/cards/CARD-002');
    await page.getByRole('button', { name: /remove card/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 4_000 });
    await expect(dialog.getByText(/remove this card\?/i)).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /remove card/i })).toBeVisible();
  });

  test('6b pressing Cancel dismisses the dialog without a DELETE; card stays', async ({ page }) => {
    let deleteCalled = false;
    await stubBase(page);
    await stubCardDetail(page);
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/CARD-002`, (route) => {
      if (route.request().method() === 'DELETE') { deleteCalled = true; route.fulfill(json({ removed: true })); }
      else if (route.request().method() === 'GET') route.fulfill(json(CARD_B_DETAIL));
      else route.continue();
    });
    await page.goto('/system/cards/CARD-002');
    await page.getByRole('button', { name: /remove card/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 4_000 });
    await dialog.getByRole('button', { name: /^cancel$/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/system\/cards\/CARD-002/);
    expect(deleteCalled).toBe(false);
  });
});

// ─── SC-1: remove card end-to-end ────────────────────────────────────────────

test.describe('SC-1: remove card end-to-end', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('confirm remove → DELETE /cards/CARD-002 sent; returns to the card list', async ({ page }) => {
    let deleteCalled = false;
    await stubBase(page);
    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/CARD-002`, (route) => {
      const m = route.request().method();
      if (m === 'DELETE') { deleteCalled = true; route.fulfill(json({ removed: true })); }
      else if (m === 'GET') route.fulfill(json(CARD_B_DETAIL));
      else route.continue();
    });

    await page.goto('/system/cards/CARD-002');
    await page.getByRole('button', { name: /remove card/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 4_000 });
    await dialog.getByRole('button', { name: /remove card/i }).click();

    // On success the page routes back to the card list.
    await expect(page).toHaveURL(/\/system\/cards$/, { timeout: 8_000 });
    expect(deleteCalled).toBe(true);
  });
});

// ─── SC-2: deactivate card (lifecycle) ───────────────────────────────────────

test.describe('SC-2: deactivate card', () => {
  test.beforeEach(async ({ context }) => { await loginAs(context, 'customer'); });

  test('Deactivate → confirm dialog, then PATCH /cards/CARD-002/status { active:false }', async ({ page }) => {
    let patchPayload: Record<string, unknown> | null = null;
    await stubBase(page);
    await stubCardDetail(page);

    await page.route(`**/api/v1/customer/${AGREEMENT_ID}/cards/CARD-002/status`, (route) => {
      if (route.request().method() === 'PATCH') {
        patchPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        route.fulfill(json({ ...CARD_B_DETAIL, paymentCardStatus: 'suspended' }));
      } else {
        route.continue();
      }
    });

    await page.goto('/system/cards/CARD-002');
    await page.getByRole('button', { name: /deactivate/i }).click();

    // Deactivating an active card requires confirmation.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 4_000 });
    await expect(dialog.getByText(/deactivate this card\?/i)).toBeVisible();
    await dialog.getByRole('button', { name: /^deactivate$/i }).click();

    await expect(async () => {
      expect(patchPayload?.active).toBe(false);
    }).toPass({ timeout: 6_000 });
  });
});
