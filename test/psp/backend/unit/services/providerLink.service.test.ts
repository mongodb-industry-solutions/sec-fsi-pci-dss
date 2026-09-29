/**
 * Where a provider's configured routes actually go, per environment.
 *
 * The failure this guards against is not hypothetical: the address used to be baked into the record
 * at seed time, which is right in exactly the environment the seeder ran in. The same seeded database
 * is promoted from local to Kanopy to production, where the bank answers on a different host and in
 * staging on an in-cluster name a browser could not reach at all.
 */
import { describe, it, expect } from 'vitest';
import {
  providerBaseUrl, tryProviderBaseUrl, declaredFor, resolveConfiguredUrl,
} from '../../../../../psp/backend/src/modules/provider/services/providerLink.service';
import { healthFromResponseCode } from '../../../../../psp/backend/src/modules/provider/services/integrationRegistry.service';
import type { ExternalProviderArrangement } from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

type Provider = Pick<ExternalProviderArrangement,
  'externalProviderBaseUrl' | 'externalProviderBaseUrlByEnvironment'>;

// A platform service: the entries NAME the link whose addresses are declared centrally.
const BANK: Provider = {
  externalProviderBaseUrl: '{{bankcore}}',
  externalProviderBaseUrlByEnvironment: {
    development: '{{bankcore}}',
    staging: '{{bankcore}}',
    production: '{{bankcore}}',
  },
};

// A third party: its hosts are its own, so they are literal, and its sandbox is a different domain.
const VENDOR: Provider = {
  externalProviderBaseUrlByEnvironment: {
    development: 'http://localhost:9100',
    staging: 'https://sandbox.vendor.example',
    production: 'https://api.vendor.example',
  },
};

describe('the provider address for an environment', () => {
  it('selects the entry for the running environment', () => {
    expect(providerBaseUrl(VENDOR, { PSP_ENVIRONMENT: 'development' })).toBe('http://localhost:9100');
    expect(providerBaseUrl(VENDOR, { PSP_ENVIRONMENT: 'staging' })).toBe('https://sandbox.vendor.example');
    expect(providerBaseUrl(VENDOR, { PSP_ENVIRONMENT: 'production' })).toBe('https://api.vendor.example');
  });

  it('binds a named platform link, so a platform service is declared in one place', () => {
    expect(providerBaseUrl(BANK, { PSP_ENVIRONMENT: 'development' })).toBe('http://localhost:8083');
    expect(providerBaseUrl(BANK, { PSP_ENVIRONMENT: 'staging' })).toBe('http://sec-fsi-pci-dss-bankcore-web-app:80');
  });

  it('falls back to the single address for a provider that has one everywhere', () => {
    const single: Provider = { externalProviderBaseUrl: 'https://one.example' };
    expect(providerBaseUrl(single, { PSP_ENVIRONMENT: 'production' })).toBe('https://one.example');
  });

  it('strips a trailing slash, so joining a path cannot produce a double one', () => {
    const slashed: Provider = { externalProviderBaseUrlByEnvironment: { staging: 'https://api.example/' } };
    expect(providerBaseUrl(slashed, { PSP_ENVIRONMENT: 'staging' })).toBe('https://api.example');
  });

  it('is undefined, not empty, for a provider with no address at all', () => {
    // The built-in engines: they resolve against this platform's own host instead.
    expect(providerBaseUrl({}, {})).toBeUndefined();
  });

  it('reports rather than throws for the read-only admin view', () => {
    const broken: Provider = { externalProviderBaseUrl: '{{bankore}}' };
    expect(() => providerBaseUrl(broken, {})).toThrow(/unknown platform link/);
    expect(tryProviderBaseUrl(broken, {}).error).toMatch(/unknown platform link/);
  });

  it('a route may override the provider for one operation only', () => {
    expect(declaredFor(VENDOR, 'staging', { staging: 'https://auth.vendor.example' }))
      .toBe('https://auth.vendor.example');
    // An override that says nothing about this environment leaves the provider's answer standing.
    expect(declaredFor(VENDOR, 'staging', { production: 'https://other.example' }))
      .toBe('https://sandbox.vendor.example');
  });
});

describe('a configured route, resolved', () => {
  it('appends a common path to the environment host', () => {
    const url = resolveConfiguredUrl(BANK, 'outbound', '/v1/cards/validations', undefined, 'staging');
    expect(url.resolved).toBe('http://sec-fsi-pci-dss-bankcore-web-app:80/v1/cards/validations');
    expect(url.path).toBe('/v1/cards/validations');
  });

  it('treats the environment entry as the WHOLE url when no path is given', () => {
    // Necessary because equivalent services do not always agree on their paths: a sandbox can expose
    // /sandbox/v2/score where production exposes /v2/score.
    const perEnvironmentPaths: Provider = {
      externalProviderBaseUrlByEnvironment: {
        staging: 'https://sandbox.vendor.example/sandbox/v2/score',
        production: 'https://api.vendor.example/v2/score',
      },
    };
    expect(resolveConfiguredUrl(perEnvironmentPaths, 'outbound', undefined, undefined, 'staging').resolved)
      .toBe('https://sandbox.vendor.example/sandbox/v2/score');
    expect(resolveConfiguredUrl(perEnvironmentPaths, 'outbound', '', undefined, 'production').resolved)
      .toBe('https://api.vendor.example/v2/score');
  });

  it('refuses a host with no path when no path was configured', () => {
    // Resolving it would dispatch at the service root, which is not the operation anyone configured.
    const result = resolveConfiguredUrl(VENDOR, 'outbound', undefined, undefined, 'production');
    expect(result.resolved).toBeUndefined();
    expect(result.error).toMatch(/no path configured for production/);
  });

  it('leaves an absolute path alone rather than prefixing a host onto it', () => {
    const pinned = resolveConfiguredUrl(BANK, 'outbound', 'https://pinned.example/v1/x', undefined, 'staging');
    expect(pinned.resolved).toBe('https://pinned.example/v1/x');
  });

  it('resolves an inbound callback against THIS platform, never the provider', () => {
    // THE DEFECT THIS FIXES. Inheriting the provider's map published the bank's own hostname as the
    // place to deliver notifications to this platform, so every callback was aimed back at the bank.
    const inbound = resolveConfiguredUrl(BANK, 'inbound', '/api/v1/providers/card-issuer/x/e/callback', undefined, 'staging');
    expect(inbound.resolved).toBe('http://sec-fsi-pci-dss-backend-web-app:80/api/v1/providers/card-issuer/x/e/callback');
    expect(inbound.resolved).not.toContain('bankcore');
  });

  it('lets an inbound route name its own receiving host', () => {
    const inbound = resolveConfiguredUrl(BANK, 'inbound', '/hook', { staging: 'https://edge.example' }, 'staging');
    expect(inbound.resolved).toBe('https://edge.example/hook');
  });

  it('reports an unresolvable link instead of leaving it in the url', () => {
    // Left in, the placeholder becomes a request to a hostname literally called that: a DNS failure
    // three layers away from the typo that caused it.
    const result = resolveConfiguredUrl({ externalProviderBaseUrl: '{{bankore}}' }, 'outbound', '/v1/x', undefined, 'staging');
    expect(result.resolved).toBeUndefined();
    expect(result.error).toMatch(/unknown platform link "bankore"/);
  });

  it('keeps payload path templating untouched, because that is substituted later', () => {
    const url = resolveConfiguredUrl(BANK, 'outbound', '/v1/accounts/{accountId}/balances', undefined, 'development');
    expect(url.resolved).toBe('http://localhost:8083/v1/accounts/{accountId}/balances');
  });
});

/**
 * A provider's health reflects the PROVIDER, not the request we sent it.
 */
describe('health from a response code', () => {
  it('treats a refusal as healthy, because the provider answered correctly', () => {
    // THE DEFECT THIS FIXES. A 4xx marked the provider degraded, so a healthy bank was shown as
    // degraded because one request carried a consent id it did not recognise or a scope we had
    // forgotten to ask for. Whoever saw the badge went looking for a fault at the bank; the fault
    // was in our own configuration.
    for (const code of [200, 201, 400, 401, 403, 404, 409, 422, 429]) {
      expect(healthFromResponseCode(code), String(code)).toBe('ok');
    }
  });

  it('treats the provider failing as degraded', () => {
    for (const code of [500, 502, 503, 504]) {
      expect(healthFromResponseCode(code), String(code)).toBe('degraded');
    }
  });
});
