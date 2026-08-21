// v37 P9: the platform realm is `leafypay`, and `local` is still accepted as an alias for it.
//
// The rename is easy; the compatibility is where it goes wrong. Login compares the realm the caller sent
// against the realm stored on the record, and after a rename those two can disagree in BOTH directions: a
// client integrated before it still SENDS `local`, and a record written before it still STORES `local`.
// Normalising one side only turns a correct password into "invalid credentials", which is the least
// debuggable failure this change could produce.
import { describe, it, expect } from 'vitest';
import {
  resolveAuthDomainName, PLATFORM_AUTH_DOMAIN,
} from '../../../../../psp/backend/src/modules/identity/models/authenticationDomain.model';

describe('the realm alias', () => {
  it('names the platform realm leafypay', () => {
    expect(PLATFORM_AUTH_DOMAIN).toBe('leafypay');
  });

  it('resolves the old name to the new one', () => {
    expect(resolveAuthDomainName('local')).toBe('leafypay');
  });

  it('leaves the new name alone', () => {
    expect(resolveAuthDomainName('leafypay')).toBe('leafypay');
  });

  it('leaves a federated realm alone', () => {
    // Only `local` is an alias. Coercing anything else would silently move a federated user into the
    // platform realm, which is an authentication bypass rather than a compatibility shim.
    expect(resolveAuthDomainName('msentra')).toBe('msentra');
    expect(resolveAuthDomainName('bigid')).toBe('bigid');
  });

  it('returns an unknown realm untouched, so it still fails the comparison', () => {
    // Not mapped to the platform realm: an unrecognised value must fail exactly as it did before, rather
    // than being helpfully turned into a realm the caller never asked for.
    expect(resolveAuthDomainName('not-a-realm')).toBe('not-a-realm');
  });

  it('treats absent as absent, so the hosted login can still default it', () => {
    // Leafy Wallet sends no domain at all, and default resolution on the hosted login has to keep working.
    expect(resolveAuthDomainName(undefined)).toBeUndefined();
    expect(resolveAuthDomainName(null)).toBeUndefined();
    expect(resolveAuthDomainName('')).toBeUndefined();
  });

  it('agrees whichever side of the rename each value came from', () => {
    // The property that matters: a stored value and a sent value that mean the same realm must compare
    // equal in all four combinations.
    for (const stored of ['local', 'leafypay']) {
      for (const sent of ['local', 'leafypay']) {
        expect(resolveAuthDomainName(stored)).toBe(resolveAuthDomainName(sent));
      }
    }
  });
});

describe('the realm and the protocol are different things', () => {
  it('does not rename the local authentication TYPE', () => {
    // `partyAuthenticationDomainType: 'local'` means "a password this platform holds", as opposed to a
    // federated one. Renaming it along with the realm would have been the obvious mistake here: one names
    // the institution, the other names the mechanism.
    const model = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../../../psp/backend/src/modules/identity/models/authenticationDomain.model.ts'),
      'utf8',
    );
    expect(model).toContain("export type AuthDomainType = 'local' | 'oidc' | 'saml'");
    expect(model).not.toContain("export type AuthDomainName = 'local'");
  });
});
