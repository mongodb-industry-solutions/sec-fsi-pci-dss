/**
 * Unit tests: v27 staff consent-grant revoke + party->sub resolution
 * Source: backend/src/modules/identity/services/oauth.service.ts
 *
 * The merchant webhook dispatcher is mocked (no network). We assert that a staff override revokes
 * a grant the caller does NOT own (matched by consentId only), invalidates the tokens of the grant's
 * OWN subject (not the acting staff), and that self-scoped revoke still 404s on a foreign consentId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ dispatch: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../../../../psp/backend/src/modules/gateway/services/merchantWebhook.service', () => ({
  WebhookService: class {
    dispatch = h.dispatch;
  },
}));

import { revokeConsentGrant, resolveSubForParty } from '../../../../../psp/backend/src/modules/identity/services/oauth.service';
import { PARTY_AUTH_CONSENT_COLLECTION } from '../../../../../psp/backend/src/modules/identity/models/partyAuthConsent.model';
import { PARTY_ISSUED_TOKEN_COLLECTION } from '../../../../../psp/backend/src/modules/identity/models/partyIssuedToken.model';
import { CUSTOMER_AUTHENTICATION_COLLECTION } from '../../../../../psp/backend/src/modules/identity/models/customerAuthentication.model';

const grant = {
  consentId: 'consent-1',
  partyAuthenticationInstanceReference: 'sub-owner',
  oauthClientId: 'client-1',
  merchantAgreementInstanceReference: 'merch-1',
  grantedScopes: ['read:profile'],
  consentStatus: 'active',
};

/** Fake db that records the consent findOne filter and the token updateMany filter. */
function makeDb(consentDoc: any = grant) {
  const calls: any = {};
  return {
    calls,
    collection: (name: string) => {
      if (name === PARTY_AUTH_CONSENT_COLLECTION) {
        return {
          findOne: async (filter: any) => { calls.consentFilter = filter; return consentDoc; },
          updateOne: async (filter: any) => { calls.consentUpdate = filter; return { matchedCount: 1 }; },
        };
      }
      if (name === PARTY_ISSUED_TOKEN_COLLECTION) {
        return { updateMany: async (filter: any) => { calls.tokenFilter = filter; return { modifiedCount: 1 }; } };
      }
      if (name === CUSTOMER_AUTHENTICATION_COLLECTION) {
        return { findOne: async (filter: any) => { calls.authFilter = filter; return { customerAuthenticationInstanceReference: 'sub-owner' }; } };
      }
      return { findOne: async () => null, updateOne: async () => ({}), updateMany: async () => ({}) };
    },
  } as any;
}

beforeEach(() => h.dispatch.mockReset().mockResolvedValue(undefined));

describe('resolveSubForParty', () => {
  it('resolves a party ref to its OAuth subject', async () => {
    const db = makeDb();
    const sub = await resolveSubForParty(db, 'party-001');
    expect(sub).toBe('sub-owner');
    expect(db.calls.authFilter).toMatchObject({ partyInstanceReference: 'party-001' });
  });

  it('returns null for an empty party ref', async () => {
    expect(await resolveSubForParty(makeDb(), '')).toBeNull();
  });
});

describe('revokeConsentGrant staff override (v27)', () => {
  it('matches by consentId only and revokes the OWNER\'s tokens (not the acting staff)', async () => {
    const db = makeDb();
    await revokeConsentGrant(db, 'sub-staff', 'consent-1', 'psp', { staffOverride: true });
    // Ownership is NOT part of the lookup filter on a staff override.
    expect(db.calls.consentFilter).toEqual({ consentId: 'consent-1' });
    // Tokens invalidated for the grant's own subject.
    expect(db.calls.tokenFilter.sub).toBe('sub-owner');
  });

  it('self-scoped revoke still filters by the caller\'s sub and 404s a foreign consentId', async () => {
    const db = makeDb(null); // findOne returns null when the ownership filter does not match
    await expect(revokeConsentGrant(db, 'sub-caller', 'consent-1', 'user'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(db.calls.consentFilter).toEqual({ consentId: 'consent-1', partyAuthenticationInstanceReference: 'sub-caller' });
  });
});
