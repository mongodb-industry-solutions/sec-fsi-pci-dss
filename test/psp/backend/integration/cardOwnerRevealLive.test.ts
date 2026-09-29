// The card owner's Open Banking self-service reveal, over the wire, against the running services.
//
// A cardholder's own bank is the only place a full PAN or CVV legitimately lives, and this application
// reaches it as a TPP would: the owner's request is dispatched to the bank's CBPII surface
// (POST /v1/cards/{cardToken}/pan-reveals, /verification-values), authenticated as this application's
// own registered client, never as the person. This pins the field mapping that connects the two sides:
// the bank answers with `cardNumber`/`verificationValue`, this application's screens read `pan`/`cvv`,
// and the inbound mapping declared on the provider's event config is what makes that translation happen
// rather than every reveal answering "unavailable" with a real value sitting one field name away.
//
// Skipped unless the PSP and the bank are both listening, because there is nothing honest to assert
// against a stub for a path whose entire point is that a real institution answers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { interactiveToken } from '../../../support/authorizationFlow';
import { giamPath } from '../../../support/giamRepo';

const PSP = process.env.PSP_BASE_URL ?? 'http://localhost:8081';
const BANK = process.env.PSP_BANKCORE_BASE_URL ?? 'http://localhost:8083';
const DATA = (name: string) => JSON.parse(readFileSync(`psp/backend/data/${name}`, 'utf8'));

interface AuthSeed { userName: string; accountHolderRef: string; roleName: string }
interface AgreementSeed { customerAgreementInstanceReference: string; partyInstanceReference: string }
interface CardSeed { paymentCardInstanceReference: string; customerAgreementInstanceReference: string }

async function reachable(url: string, path = '/api/v1/health'): Promise<boolean> {
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch { return false; }
}

/** A customer with at least one saved card, so the reveal has something to reveal. */
function cardOwner(): { auth: AuthSeed; agreementId: string; cardId: string } | null {
  const identities = JSON.parse(readFileSync(giamPath('backend/data/identities.json'), 'utf8')) as Array<{
    userName: string; accountHolderRef?: string; roleName?: string;
  }>;
  const agreements = DATA('customerAgreements.json') as AgreementSeed[];
  const cards = DATA('paymentCards.json') as CardSeed[];
  const cardsByAgreement = new Map<string, CardSeed[]>();
  for (const card of cards) {
    const list = cardsByAgreement.get(card.customerAgreementInstanceReference) ?? [];
    list.push(card);
    cardsByAgreement.set(card.customerAgreementInstanceReference, list);
  }

  for (const identity of identities) {
    if (identity.roleName !== 'customer' || !identity.accountHolderRef) continue;
    const agreement = agreements.find((a) => a.partyInstanceReference === identity.accountHolderRef);
    if (!agreement) continue;
    const held = cardsByAgreement.get(agreement.customerAgreementInstanceReference);
    if (!held?.length) continue;
    return {
      auth: { userName: identity.userName, accountHolderRef: identity.accountHolderRef, roleName: 'customer' },
      agreementId: agreement.customerAgreementInstanceReference,
      cardId: held[0].paymentCardInstanceReference,
    };
  }
  return null;
}

describe('v37 P6.2d: a card owner reveals their own PAN and CVV through the bank', () => {
  it('answers with the value, not "unavailable", for a real seeded card', async () => {
    const [pspLive, bankLive] = await Promise.all([reachable(PSP), reachable(BANK, '/health')]);
    if (!pspLive || !bankLive) return;

    const owner = cardOwner();
    if (!owner) return;

    const token = await interactiveToken(
      'http://127.0.0.1:8085', 'LeafyIdp', owner.auth.userName, 'demo-password',
      'leafypay-console', 'http://localhost:8080/api/auth/callback',
    );
    if (!token) return;

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const base = `${PSP}/api/v1/customer/${owner.agreementId}/cards/${owner.cardId}`;

    const pan = await fetch(`${base}/pan`, { method: 'POST', headers, body: '{}' });
    const panBody = await pan.json().catch(() => ({})) as { pan?: string; error?: string };
    expect(pan.status, `pan reveal: ${JSON.stringify(panBody)}`).toBe(200);
    // A digit string, not the masked display and not the "unavailable" shape this bug produced.
    expect(panBody.pan, 'the bank answered but the field mapping never reached the caller').toMatch(/^\d{13,19}$/);

    const cvv = await fetch(`${base}/cvv`, { method: 'POST', headers, body: '{}' });
    const cvvBody = await cvv.json().catch(() => ({})) as { cvv?: string; error?: string };
    expect(cvv.status, `cvv reveal: ${JSON.stringify(cvvBody)}`).toBe(200);
    expect(cvvBody.cvv).toMatch(/^\d{3,4}$/);
  });
});
