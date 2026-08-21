/**
 * E2E: v32 F7 staff drill-down from a card to its funding account.
 * Routes: /system/cards/[cardId] -> /system/accounts/[accountId].
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json, stubPermissions } from './support/auth';

const CARD_ID = 'e82589a6-dd5e-4a27-a140-083fe3f76385';
const AGREEMENT = 'f1000071-0000-4000-8000-000000000071';
const PARTY = 'b0000071-0000-4000-8000-000000000071';
const ACCOUNT = 'pau00056-0000-4000-8000-000000000056';

const CARD = {
  paymentCardInstanceReference: CARD_ID,
  customerAgreementInstanceReference: AGREEMENT,
  paymentCardReference: 'pm_7f3842cb2069549a',
  paymentCardMaskedPanDisplay: '****-****-****-4153',
  paymentCardAlias: 'Personal',
  paymentCardStatus: 'active',
  paymentCardNetwork: 'visa',
  paymentCardExpirationDate: '2029-04-30',
  fundingPayoutAccountInstanceReference: ACCOUNT,
  paymentCardIsPreferred: true,
};

const ACCOUNT_DOC = {
  payoutAccountInstanceReference: ACCOUNT,
  partyInstanceReference: PARTY,
  payoutAccountAlias: 'Main account',
  payoutAccountType: 'bank_account',
  payoutAccountStatus: 'active',
  payoutAccountCurrency: 'EUR',
  payoutAccountCountryCode: 'ES',
  payoutAccountBankName: 'Banco Demo',
  payoutAccountHolderName: 'Ahmed Hassan',
  payoutAccountPreferredRail: 'sepa',
  payoutAccountIsDefault: true,
  payoutAccountHasIban: true,
  payoutAccountHasRoutingNumber: false,
};

const PERMS = {
  customers: ['view', 'viewSensitive'],
  accounts: ['view', 'viewSensitive'],
  cards: ['view', 'viewSensitive'],
  transactions: ['view', 'viewSensitive'],
  fraudCases: ['view'],
  auditEvents: ['view'],
  modules: ['view'],
};

// Playwright matches routes in reverse registration order: generic first, specific last.
async function stubApi(page: Page, seen: { accountPartyRefs: string[] }) {
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/transactions**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/customer/by-id/**', (r) => r.fulfill(json({
    customerAgreementInstanceReference: AGREEMENT, partyInstanceReference: PARTY,
    customerName: 'Ahmed Hassan', contactPiiRestricted: false,
  })));
  await page.route('**/api/v1/customer/*/cards/*', (r) => r.fulfill(json(CARD)));
  // Answers only for the owning party, as the backend does.
  await page.route('**/api/v1/accounts/*/*', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const partyRef = parts[parts.length - 2];
    seen.accountPartyRefs.push(partyRef);
    if (partyRef !== PARTY) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Account not found' }) });
    }
    return route.fulfill(json(ACCOUNT_DOC));
  });
  await page.route('**/api/v1/accounts/*/*/movements**', (r) => r.fulfill(json({ movements: [], total: 0 })));
  await page.route('**/api/v1/accounts/*/*/cards**', (r) => r.fulfill(json({ results: [CARD], total: 1 })));
}

test.describe('v32 F7: card to funding account, as staff', () => {
  for (const role of ['security_auditor', 'level2_investigator'] as const) {
    test(`${role} reaches the funding account from the card`, async ({ page, context }) => {
      const seen = { accountPartyRefs: [] as string[] };
      await loginAs(context, role);
      await stubPermissions(page, PERMS, role);
      await stubApi(page, seen);

      await page.goto(`/system/cards/${CARD_ID}?ctx=staff&customerId=${AGREEMENT}&partyRef=${PARTY}`);
      const link = page.getByRole('link', { name: /account/i }).first();
      await expect(link).toBeVisible({ timeout: 15000 });

      const href = await link.getAttribute('href');
      expect(href, 'the funding-account link must carry the staff context').toContain('ctx=staff');
      expect(href).toContain(`partyRef=${PARTY}`);

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/system/accounts/${ACCOUNT}`));
      await expect(page.getByRole('heading', { name: 'Main account' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/could not be found or you do not have access/i)).toHaveCount(0);
      expect(seen.accountPartyRefs).toContain(PARTY);
    });
  }
});
