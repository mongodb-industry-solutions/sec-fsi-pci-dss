// v37 P1.5a/P1.5c: the shared link resolver, the one place that turns an environment into absolute
// endpoints. A wrong host here fails as an opaque timeout or a generic 503, so it is asserted here.
import { describe, it, expect } from 'vitest';
import {
  resolvePlatformLinks, absoluteEndpoint, isAbsoluteHttpUrl, linkKind, assertLinks,
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
