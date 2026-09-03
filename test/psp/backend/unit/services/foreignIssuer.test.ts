// v39 §10.11: LeafyPay accepts a conforming token from an issuer that is NOT this authority.
//
// This is the portability claim, and it is the one worth proving because it is the one most easily
// untrue by accident. An application can pass every test in this repository while being quietly
// coupled to the specific authority that ships with it: a hardcoded issuer host, a bespoke claim, a
// key set fetched from somewhere it happened to know about. None of that shows up until somebody
// tries to put a different authority behind it, which is exactly when it is expensive to discover.
//
// So this test stands up a DIFFERENT issuer. It generates its own key pair, serves its own discovery
// document and its own key set over HTTP, and mints a token in the RFC 9068 profile. Nothing in it
// comes from the identity authority in this repository. If LeafyPay accepts that token and refuses a
// bad one from the same issuer, the contract is a contract rather than a convention.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, Server } from 'http';
import { generateKeyPairSync, createSign, KeyObject } from 'crypto';
import { AddressInfo } from 'net';

const REALM = 'somebody-elses-realm';
const AUDIENCE = 'leafypay';

let server: Server;
let issuer: string;
let privateKey: KeyObject;
let kid: string;

function base64url(value: object | Buffer): string {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return raw.toString('base64url');
}

/** A token in the shape the contract specifies, signed by the foreign issuer. */
function mint(claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = base64url({ alg: 'RS256', typ: 'at+jwt', kid, ...header });
  const body = base64url(claims as object);
  const signer = createSign('sha256');
  signer.update(`${head}.${body}`);
  signer.end();
  return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: AUDIENCE,
    sub: 'sub-from-another-authority',
    jti: 'jti-1',
    iat: now,
    nbf: now,
    exp: now + 900,
    scope: 'openid profile',
    client_id: AUDIENCE,
    // The one claim this platform relies on beyond the standard, and it is documented in the issuer
    // contract precisely so a foreign issuer can produce it.
    // v40: a permission is the string `resource:action`, one spelling everywhere it appears.
    permissions: ['transactions:view'],
    ...overrides,
  };
}

beforeAll(async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: 'jwk' }) as unknown as Record<string, string>;
  kid = 'foreign-key-1';

  server = createServer((request, response) => {
    const send = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url?.endsWith('/.well-known/openid-configuration')) {
      return send({
        issuer,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
      });
    }
    if (request.url?.endsWith('/certs')) {
      return send({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/${REALM}`;

  // The application is told to trust THIS issuer, and nothing else changes. That is the whole
  // integration: one URL. If more than this were needed, the contract would not be portable.
  vi.doMock('../../../../../psp/backend/src/config', () => ({
    config: {
      giam: {
        issuerUrl: issuer,
        audience: AUDIENCE,
        jwksCacheSeconds: 300,
        resourceServerName: AUDIENCE,
      },
    },
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

describe('v39 §10.11: the issuer contract is a contract, not a convention', () => {
  it('accepts a conforming token from an authority this repository did not build', async () => {
    const { verifyAccessToken } = await verifier();
    const claims = await verifyAccessToken(mint(validClaims()));

    expect(claims, 'a conforming foreign token was refused').not.toBeNull();
    expect(claims?.sub).toBe('sub-from-another-authority');
    // The permissions claim survives the crossing, which is what makes authorisation work at all.
    expect(claims?.permissions).toEqual(['transactions:view']);
  });

  it('fetches the key set from the issuer it was told to trust, and nowhere else', async () => {
    // Proven by the fact that the token above verified: the key that signed it exists only on this
    // test's server, and the application had no other way to obtain it.
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(validClaims()))).not.toBeNull();
  });

  it('still refuses a token from that issuer signed by a key it does not publish', async () => {
    const { verifyAccessToken } = await verifier();
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });

    const head = base64url({ alg: 'RS256', typ: 'at+jwt', kid });
    const body = base64url(validClaims());
    const signer = createSign('sha256');
    signer.update(`${head}.${body}`);
    signer.end();
    const forged = `${head}.${body}.${signer.sign(stranger.privateKey).toString('base64url')}`;

    // Trusting an issuer is not trusting anyone who claims to be it. The key set is what decides.
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it('still refuses a token whose issuer is somebody else again', async () => {
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(validClaims({ iss: 'https://a-third-party.example' })))).toBeNull();
  });

  it('still refuses a token that was not issued for this application', async () => {
    const { verifyAccessToken } = await verifier();
    expect(await verifyAccessToken(mint(validClaims({ aud: 'a-different-resource-server' })))).toBeNull();
  });

  it('still refuses the classic forgeries, whoever the issuer is', async () => {
    const { verifyAccessToken } = await verifier();

    // A foreign issuer does not get a weaker verification than the local one. Each of these is an
    // accepted forgery rather than a failed parse, so each must be refused explicitly.
    expect(await verifyAccessToken(mint(validClaims(), { alg: 'none' })), 'alg none').toBeNull();
    expect(await verifyAccessToken(mint(validClaims(), { alg: 'HS256' })), 'symmetric alg').toBeNull();
    expect(
      await verifyAccessToken(mint(validClaims(), { jku: 'https://attacker.example/keys' })),
      'attacker-supplied jku',
    ).toBeNull();
    expect(await verifyAccessToken(mint(validClaims(), { kid: 'a-key-nobody-published' })), 'unknown kid').toBeNull();
    expect(
      await verifyAccessToken(mint(validClaims({ exp: Math.floor(Date.now() / 1000) - 3600 }))),
      'expired',
    ).toBeNull();
  });
});
