/**
 * The scope catalog, which stayed.
 *
 * The authorization-server half of this file went with the authorization server: applying a user
 * scope selection and validating an authorization request are the identity authority's, and are
 * covered by its own suite. What remains here is the CATALOG, which is this product describing its
 * own scopes in its own words, and that is domain knowledge rather than an access decision.
 */
import { describe, it, expect } from 'vitest';
import {
  SCOPE_CATALOG,
  describeScope,
  requiredScopesIn,
} from '../../../../../psp/backend/src/modules/gateway/services/merchantOAuth.service';

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
