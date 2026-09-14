/**
 * Unit tests: a seeded provider credential asks the realm that exists.
 * Source: psp/backend/src/vendors/seed/resolveProviderCredential.ts
 *         psp/backend/data/externalProviderArrangement.json
 *
 * Four provider records carried `/realms/bankcore/...` as their token path. There is no `bankcore`
 * realm and there never was: ADR-003 keeps the bank a CLIENT of the shared realm, separated by its
 * own resource server, roles and audience rather than by a directory of its own. So every call the
 * PSP makes as a TPP asked a realm the authority does not know, got HTTP 400 `unknown realm`, and
 * surfaced as "Transfer could not be submitted to the payment rail" with the real cause two layers
 * down in `failureReason`. Card authorisation and the account reads failed the same way.
 *
 * The realm belongs to the environment, not to a fixture, so the resolver composes it and these
 * tests pin both issuer shapes the deployments actually use: with the realm in the base URL and
 * without it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBankcoreLink } from '../../../../../psp/backend/src/vendors/seed/resolveProviderCredential';
import type { ExternalProviderArrangement } from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

const FIXTURE = join(process.cwd(), 'psp', 'backend', 'data', 'externalProviderArrangement.json');
const records = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ExternalProviderArrangement[];

const credentialed = records.filter((r) => r.authConfig?.scheme === 'oauth2_cc');

/** Resolves a copy under a given authority issuer, without disturbing the fixture. */
function resolvedUnder(issuer: string, record: ExternalProviderArrangement): string {
  const previous = process.env.GIAM_ISSUER_URL;
  process.env.GIAM_ISSUER_URL = issuer;
  try {
    const copy = JSON.parse(JSON.stringify(record)) as ExternalProviderArrangement;
    resolveBankcoreLink(copy);
    return copy.authConfig!.scheme === 'oauth2_cc' ? copy.authConfig!.oauth2.tokenEndpoint : '';
  } finally {
    if (previous === undefined) delete process.env.GIAM_ISSUER_URL;
    else process.env.GIAM_ISSUER_URL = previous;
  }
}

describe('seeded provider token endpoints', () => {
  it('finds the records that carry a client credential, so the checks below are not vacuous', () => {
    expect(credentialed.length).toBeGreaterThan(0);
  });

  it('names no realm in the fixture: the realm is the environment\'s', () => {
    for (const record of credentialed) {
      const path = record.authConfig!.scheme === 'oauth2_cc' ? record.authConfig!.oauth2.tokenEndpoint : '';
      expect(path, record.externalProviderArrangementInstanceReference).not.toMatch(/\/realms\//);
    }
  });

  it('never resolves to the bankcore realm, which the authority does not have', () => {
    for (const record of credentialed) {
      expect(resolvedUnder('http://127.0.0.1:8085/realms/LeafyIdp', record)).not.toContain('/realms/bankcore/');
      expect(resolvedUnder('http://127.0.0.1:8085', record)).not.toContain('/realms/bankcore/');
    }
  });

  it('takes the realm from an issuer that already carries one', () => {
    for (const record of credentialed) {
      expect(resolvedUnder('http://authority.example/realms/LeafyIdp', record))
        .toBe('http://authority.example/realms/LeafyIdp/protocol/openid-connect/token');
    }
  });

  it('supplies the default realm when the issuer names none', () => {
    for (const record of credentialed) {
      expect(resolvedUnder('http://127.0.0.1:8085', record))
        .toBe('http://127.0.0.1:8085/realms/LeafyIdp/protocol/openid-connect/token');
    }
  });

  it('does not double the realm segment under either issuer shape', () => {
    for (const record of credentialed) {
      for (const issuer of ['http://127.0.0.1:8085/realms/LeafyIdp', 'http://127.0.0.1:8085']) {
        const resolved = resolvedUnder(issuer, record);
        expect(resolved.match(/\/realms\//g) ?? [], resolved).toHaveLength(1);
      }
    }
  });

  it('resolves to the standard OIDC token path', () => {
    for (const record of credentialed) {
      expect(resolvedUnder('http://127.0.0.1:8085/realms/LeafyIdp', record))
        .toMatch(/\/protocol\/openid-connect\/token$/);
    }
  });
});
