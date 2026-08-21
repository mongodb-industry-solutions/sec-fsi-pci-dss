/**
 * E2E: v33 FR-v33-04, the transaction-to-card link resolves for staff.
 * Route: /system/transactions/[txnId].
 *
 * This is the surface the v33 audit found broken. All 209 seeded transactions carried a
 * `paymentCardReference` matching no card, so `GET /api/v1/customer/card-by-token/:token` 404'd for
 * every one of them: the card token rendered as inert text, the "Card held by" shared-card indicator
 * never appeared, and an investigator could not pivot from a transaction to the card it was made with.
 * The account reference resolved fine, which is why lists and history looked healthy and the gap went
 * unnoticed.
 *
 * Both branches are asserted, so a regression is distinguishable from a card that genuinely is not on
 * file (an external token the PSP never stored is a legitimate state, and must not render a dead link).
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json, stubPermissions } from './support/auth';

const CARD_TOKEN = 'pm_7f3842cb2069549a';
const AGREEMENT = 'ag-uuid-0001';
const PARTY = 'party-uuid-0001';
const CARD_INSTANCE = 'card-uuid-0001';

const TXN = {
  cardTransactionInstanceReference: 'txn-v33-01',
  paymentCardReference: CARD_TOKEN,
  cardTransactionAccountReference: 'ACC-V33-0001',
  cardTransactionAmount: { amount: 129.4, currency: 'EUR' },
  cardTransactionDateTime: '2026-06-02T10:15:00Z',
  cardTransactionStatus: 'settled',
  cardTransactionType: 'purchase',
  cardTransactionChannel: 'online',
  cardTransactionMerchantName: 'Leafy Grocers',
  cardTransactionMerchantCategoryCode: '5411',
  // v33: the masked PAN on the transaction equals the one on the card it points at.
  cardTransactionMaskedPanDisplay: '****-****-****-9549',
  sensitive: null,
};

const CARD_ON_FILE = {
  paymentCardInstanceReference: CARD_INSTANCE,
  customerAgreementInstanceReference: AGREEMENT,
  paymentCardReference: CARD_TOKEN,
  paymentCardMaskedPanDisplay: '****-****-****-9549',
  paymentCardNetwork: 'VISA',
  paymentCardStatus: 'active',
  fundingPayoutAccountInstanceReference: 'payout-uuid-0001',
};

const CUSTOMER = {
  customerAgreementInstanceReference: AGREEMENT,
  partyInstanceReference: PARTY,
  customerAgreementReference: 'ACC-V33-0001',
  partyName: 'Test Customer',
  sensitive: null,
};

/** `cardResolves: false` reproduces the pre-v33 state: the token matches no stored card. */
async function stub(page: Page, cardResolves: boolean) {
  await stubPermissions(page, { transactions: ['view'], customers: ['view'], cards: ['view'] });
  // The shared-card registry lookup lives on the customer module (GET /api/v1/customer/card-registry/
  // :token), even though the client helper is named api.fraud.cardRegistry.
  await page.route('**/api/v1/customer/card-registry/**', (r) =>
    r.fulfill(json({ paymentCardReference: CARD_TOKEN, cardHolderCount: 2 })),
  );
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/customer/card-by-token/**', (r) =>
    cardResolves ? r.fulfill(json(CARD_ON_FILE)) : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"No card on file for this token"}' }),
  );
  await page.route('**/api/v1/customer/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    // Playwright matches the most recently registered route first, so the two specific customer
    // lookups above have to be handed back explicitly.
    if (p.includes('/card-by-token/') || p.includes('/card-registry/')) return route.fallback();
    return route.fulfill(json(CUSTOMER));
  });
  await page.route('**/api/v1/transactions**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (/\/transactions\/[^/]+$/.test(p)) return route.fulfill(json(TXN));
    return route.fulfill(json({ results: [TXN], total: 1, page: 1, limit: 20 }));
  });
}

test.describe('FR-v33-04: the card link on a transaction detail', () => {
  test('an investigator can pivot from the transaction to the card it was made with', async ({ page, context }) => {
    await stub(page, true);
    await loginAs(context, 'level2_investigator');
    await page.goto('/system/transactions/txn-v33-01');

    await expect(page.getByRole('heading', { name: 'Leafy Grocers' })).toBeVisible({ timeout: 15000 });

    // The token is a link into the card detail, carrying the staff context the card page needs.
    const cardLink = page.getByRole('link', { name: new RegExp(CARD_TOKEN) });
    await expect(cardLink).toBeVisible({ timeout: 8000 });
    const href = await cardLink.getAttribute('href');
    expect(href).toContain(`/system/cards/${CARD_INSTANCE}`);
    expect(href).toContain('ctx=staff');
    expect(href).toContain(`customerId=${AGREEMENT}`);

    // The masked PAN shown on the transaction is the card's own, so the two cannot disagree.
    await expect(page.getByText('****-****-****-9549').first()).toBeVisible();

    // The shared-card (FDS/AML) indicator resolves, which it cannot do for an orphan token.
    await expect(page.getByText(/2 customers/)).toBeVisible({ timeout: 8000 });
  });

  test('a token with no card on file renders as text, never as a dead link', async ({ page, context }) => {
    await stub(page, false);
    await loginAs(context, 'level2_investigator');
    await page.goto('/system/transactions/txn-v33-01');

    await expect(page.getByRole('heading', { name: 'Leafy Grocers' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(CARD_TOKEN).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('link', { name: new RegExp(CARD_TOKEN) })).toHaveCount(0);
  });
});
