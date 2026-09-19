// v37 P1.5a/P1.5c: the shared link resolver, the one place that turns an environment into absolute
// endpoints. A wrong host here fails as an opaque timeout or a generic 503, so it is asserted here.
import { describe, it, expect } from 'vitest';
import {
  resolvePlatformLinks, absoluteEndpoint, isAbsoluteHttpUrl, linkKind, assertLinks,
  resolveLinks, tryResolveLinks, platformEnvironment, authorityIssuerUrl,
  LINK_MATRIX, PLATFORM_ENVIRONMENTS,
} from '@leafypay/platform-links';

const LOCAL = {};
const STAGING = {
  PSP_BANKCORE_BASE_URL: 'http://sec-fsi-pci-dss-bankcore-web-app:80',
  PSP_BASE_URL: 'http://sec-fsi-pci-dss-backend-web-app:80',
  PSP_URL_FRONTEND: 'https://leafy-pay.industrysolutions.staging.corp.mongodb.com',
};

describe('v37 P1.5a: environment aware platform links', () => {
  it('local needs no configuration at all', () => {
    const links = resolvePlatformLinks(LOCAL);
    expect(links.bankcoreBaseUrl).toBe('http://localhost:8083');
    expect(links.pspBaseUrl).toBe('http://127.0.0.1:8081');
    expect(links.pspFrontendUrl).toBe('http://localhost:3000');
  });

  it('staging and production resolve the in-cluster service names', () => {
    const links = resolvePlatformLinks(STAGING);
    expect(links.bankcoreBaseUrl).toBe('http://sec-fsi-pci-dss-bankcore-web-app:80');
    expect(links.pspBaseUrl).toBe('http://sec-fsi-pci-dss-backend-web-app:80');
  });

  it('trailing slashes never reach a record', () => {
    const links = resolvePlatformLinks({ PSP_BANKCORE_BASE_URL: 'http://bank:80/' });
    expect(links.bankcoreBaseUrl).toBe('http://bank:80');
    expect(absoluteEndpoint('http://bank:80/', '/v1/accounts')).toBe('http://bank:80/v1/accounts');
  });

  it('the bare name is accepted as well as the PSP_ prefixed one', () => {
    expect(resolvePlatformLinks({ BANKCORE_BASE_URL: 'http://bank:80' }).bankcoreBaseUrl).toBe('http://bank:80');
    // The prefixed variable wins, since that is the platform convention.
    expect(resolvePlatformLinks({
      BANKCORE_BASE_URL: 'http://ignored:80',
      PSP_BANKCORE_BASE_URL: 'http://bank:80',
    }).bankcoreBaseUrl).toBe('http://bank:80');
  });

  it('an in-cluster hostname is private and an ingress hostname is public', () => {
    expect(linkKind('http://sec-fsi-pci-dss-bankcore-web-app:80')).toBe('private');
    expect(linkKind('http://localhost:8083')).toBe('private');
    expect(linkKind('http://host.docker.internal:8083')).toBe('private');
    expect(linkKind('https://leafy-pay.industrysolutions.staging.corp.mongodb.com')).toBe('public');
    expect(linkKind('/api/v1/modules/fds/score')).toBe('invalid');
  });

  it('rejects a relative endpoint, which is what a hostname-free fixture would leave behind', () => {
    expect(isAbsoluteHttpUrl('/v1/accounts')).toBe(false);
    expect(isAbsoluteHttpUrl('http://bank:80/v1/accounts')).toBe(true);
  });

  it('a private hostname on a browser facing record fails validation', () => {
    const checks = assertLinks([
      { name: 'bankcore endpoint', value: STAGING.PSP_BANKCORE_BASE_URL, expected: 'private' },
      { name: 'frontend', value: 'http://sec-fsi-pci-dss-frontend-web-app:80', expected: 'public' },
    ]);
    expect(checks[0].ok).toBe(true);
    expect(checks[1].ok).toBe(false);
    expect(checks[1].detail).toContain('private hostname');
  });

  it('local development is not reported as a private-host defect', () => {
    // Everything is localhost locally, so a public record legitimately looks private there.
    const links = resolvePlatformLinks(LOCAL);
    const checks = assertLinks([
      { name: 'bankcore endpoint', value: links.bankcoreBaseUrl, expected: 'private' },
      { name: 'frontend', value: links.pspFrontendUrl, expected: 'public' },
    ]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});

/**
 * The matrix and the placeholder: every address declared once, one variable selecting the column.
 *
 * What this replaces is a host baked into a record at seed time. That worked only while a database
 * never outlived the environment it was seeded in, and it does: the same seeded database is promoted
 * from local to Kanopy to production, where the bank answers on a different host and in staging on an
 * in-cluster name a browser could not reach at all.
 */
describe('per-environment link resolution', () => {
  it('one variable selects the column, and the record never changes', () => {
    const record = '{{bankcore}}';
    expect(resolveLinks(record, { PSP_ENVIRONMENT: 'development' })).toBe('http://localhost:8083');
    expect(resolveLinks(record, { PSP_ENVIRONMENT: 'staging' })).toBe('http://sec-fsi-pci-dss-bankcore-web-app:80');
    expect(resolveLinks(record, { PSP_ENVIRONMENT: 'production' })).toBe('http://sec-fsi-pci-dss-bankcore-web-app:80');
  });

  it('an unset environment is development, so local needs no configuration', () => {
    expect(platformEnvironment({})).toBe('development');
    expect(resolveLinks('{{psp}}', {})).toBe('http://127.0.0.1:8081');
  });

  it('a per-link variable still wins over the column', () => {
    // The narrower statement, made by whoever deployed this exact process.
    expect(resolveLinks('{{bankcore}}', {
      PSP_ENVIRONMENT: 'staging',
      PSP_BANKCORE_BASE_URL: 'http://pinned:9000',
    })).toBe('http://pinned:9000');
  });

  it('a path keeps its placeholder-free remainder', () => {
    expect(resolveLinks('{{psp}}/api/v1/providers/callback/bankcore', { PSP_ENVIRONMENT: 'staging' }))
      .toBe('http://sec-fsi-pci-dss-backend-web-app:80/api/v1/providers/callback/bankcore');
  });

  it('the issuer carries the realm, and is not doubled when the base URL already names one', () => {
    expect(resolveLinks('{{authorityIssuer}}/protocol/openid-connect/token', {}))
      .toBe('http://127.0.0.1:8085/realms/LeafyIdp/protocol/openid-connect/token');
    expect(authorityIssuerUrl({ GIAM_ISSUER_URL: 'http://giam:80/realms/Other' }))
      .toBe('http://giam:80/realms/Other');
  });

  it('a typo in the environment throws instead of quietly meaning development', () => {
    // The failure this prevents: a production process resolving the bank to localhost.
    expect(() => platformEnvironment({ PSP_ENVIRONMENT: 'stagin' })).toThrow(/unknown platform environment/);
  });

  it('a link name this platform does not have throws where it is read', () => {
    // Not left in the URL: that turns a typo into a DNS failure three layers away from its cause.
    expect(() => resolveLinks('{{bankore}}/v1/cards', {})).toThrow(/unknown platform link "bankore"/);
    expect(tryResolveLinks('{{bankore}}/v1/cards', {})).toBeUndefined();
  });

  it('single braces are left alone, because that is payload path templating', () => {
    expect(resolveLinks('/v1/accounts/{accountId}/balances', {})).toBe('/v1/accounts/{accountId}/balances');
  });

  it('validation binds the placeholder first, so setup proves it resolves', () => {
    const [check] = assertLinks(
      [{ name: 'bankcore base URL', value: '{{bankcore}}', expected: 'private' }],
      { PSP_ENVIRONMENT: 'staging' },
    );
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('{{bankcore}} -> http://sec-fsi-pci-dss-bankcore-web-app:80');
  });

  it('validation reports an unresolvable name as the configuration fault it is', () => {
    const [check] = assertLinks([{ name: 'base URL', value: '{{nope}}', expected: 'private' }], {});
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('unknown platform link');
  });

  it('every link has an address in every environment', () => {
    // A blank cell is a deployment that resolves to the empty string and fails as a malformed URL.
    // `authorityIssuer` is derived from `authority` plus the realm and is the one exception.
    for (const [name, byEnvironment] of Object.entries(LINK_MATRIX)) {
      if (name === 'authorityIssuer') continue;
      for (const environment of PLATFORM_ENVIRONMENTS) {
        expect(isAbsoluteHttpUrl(byEnvironment[environment]), `${name}.${environment}`).toBe(true);
      }
    }
  });

  it('the server-to-server links are private in every environment, and only the browser one is public', () => {
    for (const environment of PLATFORM_ENVIRONMENTS) {
      const env = { PSP_ENVIRONMENT: environment };
      expect(linkKind(resolveLinks('{{bankcore}}', env))).toBe('private');
      expect(linkKind(resolveLinks('{{psp}}', env))).toBe('private');
      expect(linkKind(resolveLinks('{{authority}}', env))).toBe('private');
    }
    // Local is loopback for everything; the deployed columns must be reachable from a browser.
    expect(linkKind(resolveLinks('{{pspFrontend}}', { PSP_ENVIRONMENT: 'staging' }))).toBe('public');
    expect(linkKind(resolveLinks('{{pspFrontend}}', { PSP_ENVIRONMENT: 'production' }))).toBe('public');
  });
});

describe('a value from the environment that cannot be a host', () => {
  it('falls back to the matrix rather than resolving to nothing', () => {
    // THE DEFECT THIS FIXES. This repository's own environment sets BASE_URL=/ , which the previous
    // "non-blank" test accepted; stripping the trailing slash then reduced it to the empty string and
    // the PSP link resolved to nothing, so every address built from it was a path with no host.
    expect(resolveLinks('{{psp}}', { BASE_URL: '/', PSP_ENVIRONMENT: 'staging' }))
      .toBe('http://sec-fsi-pci-dss-backend-web-app:80');
    expect(resolveLinks('{{psp}}', { PSP_BASE_URL: 'localhost:8081' }))
      .toBe('http://127.0.0.1:8081');
  });

  it('still honours a properly formed override', () => {
    expect(resolveLinks('{{psp}}', { PSP_BASE_URL: 'http://pinned:9000' })).toBe('http://pinned:9000');
  });
});
