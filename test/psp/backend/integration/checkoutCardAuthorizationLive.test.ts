// A redirect-checkout purchase, paid with a saved card whose funding account is held at the bank,
// over the wire against the running services.
//
// This is the exact path that regressed: card_authorization used to dispatch a payload the bank's
// hold endpoint has never accepted (missing `fundingAccount`), so every checkout purchase against a
// bank-linked card declined before the transaction was even created, and no test caught it because
// none of the checkout suites exercise a live bank. The fix (cardAuthorization.service.test.ts) is a
// unit test of the deferral; this pins the outcome the buyer actually sees.
//
// Skipped unless the PSP and the bank are both listening, and unless a local GIAM checkout is
// present: there is nothing honest to assert against a stub for a path whose entire point is that a
// real institution answers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { interactiveToken } from '../../../support/authorizationFlow';
import { giamPath, hasGiam } from '../../../support/giamRepo';

const PSP = process.env.PSP_BASE_URL ?? 'http://localhost:8081';
const BANK = process.env.PSP_BANKCORE_BASE_URL ?? 'http://localhost:8083';
const DATA = (name: string) => JSON.parse(readFileSync(`psp/backend/data/${name}`, 'utf8'));

interface AgreementSeed { customerAgreementInstanceReference: string; partyInstanceReference: string }
interface CardSeed {
  paymentCardInstanceReference: string; customerAgreementInstanceReference: string;
  paymentCardReference: string; paymentCardStatus: string; fundingPayoutAccountInstanceReference?: string;
}
interface PayoutAccountSeed {
  payoutAccountInstanceReference: string;
  payoutAccountBankAccountReference?: string;
  payoutAccountAspspReference?: string;
  payoutAccountConsentReference?: string;
}

async function reachable(url: string, path = '/api/v1/health'): Promise<boolean> {
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch { return false; }
}

/** A customer whose saved card is funded by an account actually linked to a bank (the case that
 * regressed: an unlinked account never reaches the broken dispatch, so it never proved anything). */
function cardOwnerWithBankLinkedFunding(): { userName: string; cardToken: string } | null {
  const agreements = DATA('customerAgreements.json') as AgreementSeed[];
  const cards = DATA('paymentCards.json') as CardSeed[];
  const accounts = DATA('payoutAccounts.json') as PayoutAccountSeed[];
  const accountById = new Map(accounts.map((a) => [a.payoutAccountInstanceReference, a]));
  const isBankLinked = (a?: PayoutAccountSeed) => Boolean(
    a?.payoutAccountBankAccountReference && a.payoutAccountAspspReference && a.payoutAccountConsentReference,
  );

  const identities = JSON.parse(readFileSync(giamPath('backend/data/identities.json'), 'utf8')) as Array<{
    userName: string; accountHolderRef?: string; roleName?: string;
  }>;

  for (const card of cards) {
    if (card.paymentCardStatus !== 'active') continue;
    if (!isBankLinked(accountById.get(card.fundingPayoutAccountInstanceReference ?? ''))) continue;
    const agreement = agreements.find((a) => a.customerAgreementInstanceReference === card.customerAgreementInstanceReference);
    if (!agreement) continue;
    const identity = identities.find((i) => i.roleName === 'customer' && i.accountHolderRef === agreement.partyInstanceReference);
    if (!identity) continue;
    return { userName: identity.userName, cardToken: card.paymentCardReference };
  }
  return null;
}

describe('a checkout purchase paid with a bank-funded saved card', () => {
  it('is not refused with a malformed authorisation request', async () => {
    const [pspLive, bankLive] = await Promise.all([reachable(PSP), reachable(BANK, '/health')]);
    if (!pspLive || !bankLive || !hasGiam('backend/data/identities.json')) return;

    const owner = cardOwnerWithBankLinkedFunding();
    if (!owner) return;

    const token = await interactiveToken(
      'http://127.0.0.1:8085', 'LeafyIdp', owner.userName, 'demo-password',
      'leafypay-console', 'http://localhost:8080/api/auth/callback',
    );
    if (!token) return;

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const created = await fetch(`${PSP}/api/v1/checkout/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        merchantAgreementInstanceReference: 'm0000002-0000-4000-8000-000000000002',
        amount: 12.5,
        currency: 'EUR',
        description: 'card_authorization regression check',
        returnUrl: 'http://localhost:8082/history',
        cancelUrl: 'http://localhost:8082/products',
        merchantReference: `TEST-CARDAUTH-${Date.now()}`,
      }),
    });
    const session = await created.json().catch(() => ({})) as { checkoutSessionInstanceReference?: string };
    expect(created.status, `session creation: ${JSON.stringify(session)}`).toBe(201);

    const paid = await fetch(`${PSP}/api/v1/checkout/sessions/${session.checkoutSessionInstanceReference}/pay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cardToken: owner.cardToken, cardholderName: 'Test Buyer', cardCvv: '123' }),
    });
    const outcome = await paid.json().catch(() => ({})) as {
      success?: boolean; cardTransactionInstanceReference?: string; declined?: boolean; declineReason?: string;
    };
    expect(paid.status, `pay: ${JSON.stringify(outcome)}`).toBe(200);
    // The regression's exact symptom was never reaching this point: the malformed dispatch declined
    // with "Authorization declined" before the underlying transaction was even created. This seeded
    // card and amount authorise cleanly, so a real transaction now exists (and is what would show up
    // in the buyer's payment history, which had nothing to show while this was broken).
    expect(outcome.success, `pay: ${JSON.stringify(outcome)}`).toBe(true);
    expect(outcome.cardTransactionInstanceReference).toMatch(/^[0-9a-f-]{36}$/);
  });
});
