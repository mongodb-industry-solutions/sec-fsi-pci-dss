// The issuer a token carries is the authority's PUBLIC identity; the address a service calls it on is
// whatever that deployment can route to. They are different strings in every cluster deployment, and
// the service must accept the token without either being configured as the other.
//
// This stands up an authority reachable on a local port that ADVERTISES a different public issuer,
// with a key set address under that public origin (unreachable from here, like a public host seen from
// inside a cluster that cannot hairpin). The token carries the public issuer.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, Server } from 'http';
import { generateKeyPairSync, createSign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';

const AUDIENCE = 'leafypay';
const PUBLIC_ORIGIN = 'https://giam.public.invalid';
const REALM_PATH = '/api/v1/realms/LeafyIdp';

let server: Server;
let reachable: string;
let privateKey: KeyObject;
const kid = 'split-key-1';
let advertisedIssuer = `${PUBLIC_ORIGIN}${REALM_PATH}`;

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function mint(iss: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'at+jwt', kid });
  const body = b64({ iss, aud: AUDIENCE, sub: 's', jti: 'j', iat: now, exp: now + 900, client_id: AUDIENCE, roles: [] });
  const signer = createSign('sha256');
  signer.update(`${head}.${body}`);
  signer.end();
  return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: 'jwk' }) as unknown as Record<string, string>;

  server = createServer((request, response) => {
    const send = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url?.endsWith('/.well-known/openid-configuration')) {
      return send({ issuer: advertisedIssuer, jwks_uri: `${advertisedIssuer}/protocol/oidc/certs` });
    }
    // Served only at the path under the REACHABLE address, which is where the rebased request lands.
    if (request.url === `${REALM_PATH}/protocol/oidc/certs`) {
      return send({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  reachable = `http://127.0.0.1:${(server.address() as AddressInfo).port}${REALM_PATH}`;

  vi.doMock('../../../../../psp/backend/src/config', () => ({
    config: { giam: { issuerUrl: reachable, audience: AUDIENCE, jwksCacheSeconds: 300, resourceServerName: AUDIENCE } },
  }));
});

afterAll(() => {
  server?.close();
});

async function verifier() {
  const module = await import('../../../../../psp/backend/src/vendors/security/tokenVerifier');
  module.resetVerifierCache();
  return module;
}

describe('the issuer is learned from discovery, not configured', () => {
  it('accepts a token carrying the public issuer while calling the authority on another address', async () => {
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(`${PUBLIC_ORIGIN}${REALM_PATH}`))).not.toBeNull();
  });

  it('fetches the key set through the reachable address, not the advertised public one', async () => {
    // The advertised key set host does not resolve. Verifying at all proves the request was rebased.
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(`${PUBLIC_ORIGIN}${REALM_PATH}`))).not.toBeNull();
  });

  it('still refuses a token from any other issuer, even one signed by the published key', async () => {
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(`https://elsewhere.invalid${REALM_PATH}`))).toBeNull();
    expect(await verifyAccessToken(mint(`${PUBLIC_ORIGIN}/api/v1/realms/Other`))).toBeNull();
  });
});
