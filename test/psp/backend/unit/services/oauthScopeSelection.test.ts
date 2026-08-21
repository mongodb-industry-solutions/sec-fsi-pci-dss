/**
 * Unit tests: OAuth granular consent, scope selection + validation (v18 Fase E, E-04)
 * Source: backend/src/modules/identity/services/oauth.service.ts
 *         backend/src/modules/gateway/services/merchantOAuth.service.ts
 */
import { describe, it, expect } from 'vitest';
import {
  applyUserScopeSelection,
  initiateAuthorization,
} from '../../../../../psp/backend/src/modules/identity/services/oauth.service';
import {
  SCOPE_CATALOG,
  describeScope,
  requiredScopesIn,
} from '../../../../../psp/backend/src/modules/gateway/services/merchantOAuth.service';

// Minimal merchant/oauth-client mock for resolveOAuthClient.
function makeDb(clientScopes: string[]) {
  return {
    collection: () => ({
      findOne: async () => ({
        merchantAgreementInstanceReference: 'MERCH-1',
        merchantName: 'Espresso Works',
        merchantAgreementStatus: 'active',
        merchantOAuthClient: {
          oauthClientId: 'client-1',
          oauthClientStatus: 'active',
          oauthRedirectUris: ['https://app.example.com/cb'],
          oauthGrantTypes: ['authorization_code'],
          oauthScopes: clientScopes,
          oauthRequirePkce: false,
        },
      }),
    }),
  } as any;
}

describe('SCOPE_CATALOG (E-01)', () => {
  it('marks only openid as required', () => {
    expect(SCOPE_CATALOG.openid.required).toBe(true);
    expect(SCOPE_CATALOG['read:beneficiaries'].required).toBe(false);
    expect(SCOPE_CATALOG['read:accounts'].required).toBe(false);
  });

  it('describeScope falls back gracefully for unknown scopes', () => {
    expect(describeScope('custom:thing')).toEqual({ scope: 'custom:thing', description: 'Access to custom thing', required: false });
  });

  it('requiredScopesIn returns required scopes present in the list', () => {
    expect(requiredScopesIn(['openid', 'read:beneficiaries'])).toEqual(['openid']);
    expect(requiredScopesIn(['read:beneficiaries'])).toEqual([]);
  });
});

describe('applyUserScopeSelection (E-04/E-05)', () => {
  const allowed = ['openid', 'profile', 'read:beneficiaries', 'read:accounts'];

  it('keeps only user-selected scopes within the allowlist', () => {
    expect(applyUserScopeSelection(allowed, ['profile', 'read:beneficiaries'])).toEqual(['openid', 'profile', 'read:beneficiaries']);
  });

  it('force-includes required scopes even if the user omits them', () => {
    expect(applyUserScopeSelection(allowed, ['read:beneficiaries'])).toContain('openid');
  });

  it('drops selected scopes that are not allowed', () => {
    expect(applyUserScopeSelection(allowed, ['profile', 'write:transfers'])).toEqual(['openid', 'profile']);
  });
});

describe('initiateAuthorization scope validation (E-03/E-04)', () => {
  const base = {
    clientId: 'client-1',
    redirectUri: 'https://app.example.com/cb',
    responseType: 'code',
    state: 's',
  };

  it('rejects a requested scope outside the client allowlist with invalid_scope', async () => {
    const db = makeDb(['openid', 'profile']);
    await expect(
      initiateAuthorization(db, { ...base, scope: 'openid profile read:transactions' }),
    ).rejects.toMatchObject({ oauthError: 'invalid_scope' });
  });

  it('returns scope descriptors for allowed scopes', async () => {
    const db = makeDb(['openid', 'profile', 'read:beneficiaries']);
    const v = await initiateAuthorization(db, { ...base, scope: 'openid profile read:beneficiaries' });
    expect(v.scopes).toEqual(['openid', 'profile', 'read:beneficiaries']);
    expect(v.scopeDescriptors.find((d) => d.scope === 'openid')?.required).toBe(true);
    expect(v.scopeDescriptors.find((d) => d.scope === 'read:beneficiaries')?.required).toBe(false);
  });

  it('requires openid', async () => {
    const db = makeDb(['openid', 'profile']);
    await expect(
      initiateAuthorization(db, { ...base, scope: 'profile' }),
    ).rejects.toMatchObject({ oauthError: 'invalid_scope' });
  });
});
