// Rebasing an address the authority advertises under its public origin onto the one this process reaches.
import { describe, it, expect } from 'vitest';
import { rebaseAdvertised } from '../../../../../packages/giam-client/src/discovery';

const PUBLIC = 'https://giam.public.example/api/v1/realms/LeafyIdp';
const PRIVATE = 'http://giam-svc:80/api/v1/realms/LeafyIdp';

describe('rebaseAdvertised', () => {
  it('moves an address under the advertised issuer under the reachable one', () => {
    expect(rebaseAdvertised(`${PUBLIC}/protocol/oidc/certs`, PUBLIC, PRIVATE)).toBe(`${PRIVATE}/protocol/oidc/certs`);
  });

  it('keeps the path of an address elsewhere on the advertised origin and takes the reachable origin', () => {
    expect(rebaseAdvertised('https://giam.public.example/jwks.json?v=2', PUBLIC, PRIVATE)).toBe('http://giam-svc/jwks.json?v=2');
  });

  it('does not treat a sibling path that merely starts with the issuer as part of it', () => {
    expect(rebaseAdvertised(`${PUBLIC}Other/certs`, PUBLIC, PRIVATE)).toBe('http://giam-svc/api/v1/realms/LeafyIdpOther/certs');
  });

  it('leaves an address on another host alone', () => {
    expect(rebaseAdvertised('https://cdn.example/keys', PUBLIC, PRIVATE)).toBe('https://cdn.example/keys');
  });

  it('follows an ingress that drops a path prefix when the address is under the issuer', () => {
    const prefixed = 'https://giam.public.example/giam/api/v1/realms/LeafyIdp';
    expect(rebaseAdvertised(`${prefixed}/protocol/oidc/certs`, prefixed, PRIVATE)).toBe(`${PRIVATE}/protocol/oidc/certs`);
  });
});
