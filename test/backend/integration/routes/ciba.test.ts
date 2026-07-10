/**
 * Integration tests: CIBA (Client-Initiated Backchannel Authentication) + discovery.
 * Source: backend/src/modules/identity/{controllers/ciba.controller,services/ciba.service}.ts
 *
 * Requires TEST_MONGODB_URI (+ a seeded demo DB: the Espresso CIBA client + the demo user).
 * Skips gracefully when not set. Spins up a real Fastify app.
 *
 * No key material is committed to source. The test performs the real enrollment ceremony at runtime:
 * it logs in as the demo user, generates an ephemeral ES256 key pair, registers the public key, then
 * acts as the Authentication Device by signing the CIBA challenge with the ephemeral private key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import * as crypto from 'crypto';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const CLIENT_ID = 'oauth001-0000-4000-8000-000000000001';
const CLIENT_SECRET = 'espresso-demo-secret-2026';
const DEMO_EMAIL = 'luis.fernandez@back.es';
const DEMO_PASSWORD = 'demo-password';

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

// An ephemeral software authenticator generated per test run (mirrors the browser WebCrypto authenticator).
function makeAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Sign a challenge and return a raw r||s base64url signature (the WebCrypto form the server accepts).
  const sign = (challenge: string): string => {
    const der = crypto.createSign('SHA256').update(Buffer.from(challenge, 'utf8')).sign(privateKey);
    let offset = 2;
    const readInt = (): Buffer => {
      offset++; const len = der[offset++];
      let v = der.subarray(offset, offset + len); offset += len;
      if (v.length > 32) v = v.subarray(v.length - 32);
      if (v.length < 32) v = Buffer.concat([Buffer.alloc(32 - v.length), v]);
      return v;
    };
    const r = readInt(); const s = readInt();
    return Buffer.concat([r, s]).toString('base64url');
  };
  return { publicKeyPem: publicKey, sign };
}

describe('CIBA', () => {
  let app: FastifyInstance;
  let session = '';
  let credentialId = '';
  let authenticator: ReturnType<typeof makeAuthenticator>;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();

    // Log in as the demo user and enroll a fresh credential (real registration ceremony).
    const login = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD, domain: 'local' });
    session = login.body.token;
    authenticator = makeAuthenticator();
    const ch = await supertest(app.server)
      .post('/api/v1/auth/enroll/challenge')
      .set('Authorization', `Bearer ${session}`).send({});
    const signature = authenticator.sign(ch.body.challenge);
    const reg = await supertest(app.server)
      .post('/api/v1/auth/enroll')
      .set('Authorization', `Bearer ${session}`)
      .send({ challenge: ch.body.challenge, publicKeyPem: authenticator.publicKeyPem, alg: 'ES256', signature, authenticatorMetadata: { deviceName: 'test-device' } });
    credentialId = reg.body.credentialId;
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  skip('discovery advertises the backchannel endpoint + ciba grant', async () => {
    const res = await supertest(app.server).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body.backchannel_authentication_endpoint).toContain('/api/v1/auth/bc-authorize');
    expect(res.body.grant_types_supported).toContain('urn:openid:params:grant-type:ciba');
    expect(res.body.backchannel_token_delivery_modes_supported).toEqual(expect.arrayContaining(['poll', 'ping', 'push']));
  });

  skip('enrollment stored a credential and lists it (owner-scoped)', async () => {
    expect(credentialId).toBeTruthy();
    const res = await supertest(app.server).get('/api/v1/auth/enroll').set('Authorization', `Bearer ${session}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials.some((c: { credentialId: string }) => c.credentialId === credentialId)).toBe(true);
  });

  skip('happy path: bc-authorize -> approve (signature) -> token poll returns tokens', async () => {
    const bc = await supertest(app.server)
      .post('/api/v1/auth/bc-authorize')
      .set('Authorization', basicAuth())
      .set('Content-Type', 'application/json')
      .send({ login_hint: DEMO_EMAIL, scope: 'openid profile' });
    expect(bc.status).toBe(200);
    const authReqId = bc.body.auth_req_id;
    expect(authReqId).toBeTruthy();

    // Poll before approval -> authorization_pending.
    const pending = await supertest(app.server)
      .post('/api/v1/auth/token').type('form').set('Authorization', basicAuth())
      .send({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: authReqId });
    expect(pending.status).toBe(400);
    expect(pending.body.error).toBe('authorization_pending');

    // AD fetches the challenge (no session) and approves with a signature.
    const chal = await supertest(app.server).get(`/api/v1/auth/bc-authorize/${authReqId}`);
    expect(chal.status).toBe(200);
    const approve = await supertest(app.server)
      .post(`/api/v1/auth/bc-authorize/${authReqId}/approve`)
      .send({ credentialId, signature: authenticator.sign(chal.body.challenge) });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');

    // Poll again -> tokens.
    const tok = await supertest(app.server)
      .post('/api/v1/auth/token').type('form').set('Authorization', basicAuth())
      .send({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: authReqId });
    expect(tok.status).toBe(200);
    expect(tok.body.access_token).toBeTruthy();
    expect(tok.body.id_token).toBeTruthy();
    expect(tok.body.refresh_token).toBeTruthy();

    // Redeeming a consumed auth_req_id again -> invalid_grant.
    const reuse = await supertest(app.server)
      .post('/api/v1/auth/token').type('form').set('Authorization', basicAuth())
      .send({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: authReqId });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  skip('bad signature is rejected at approval', async () => {
    const bc = await supertest(app.server)
      .post('/api/v1/auth/bc-authorize').set('Authorization', basicAuth())
      .set('Content-Type', 'application/json').send({ login_hint: DEMO_EMAIL, scope: 'openid' });
    const authReqId = bc.body.auth_req_id;
    const approve = await supertest(app.server)
      .post(`/api/v1/auth/bc-authorize/${authReqId}/approve`)
      .send({ credentialId, signature: Buffer.from('garbage').toString('base64url') });
    expect(approve.status).toBe(401);
  });

  skip('more than one hint -> invalid_request', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/auth/bc-authorize').set('Authorization', basicAuth())
      .set('Content-Type', 'application/json')
      .send({ login_hint: DEMO_EMAIL, id_token_hint: 'x.y.z', scope: 'openid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  skip('GET challenge alone grants nothing without a valid signature', async () => {
    const bc = await supertest(app.server)
      .post('/api/v1/auth/bc-authorize').set('Authorization', basicAuth())
      .set('Content-Type', 'application/json').send({ login_hint: DEMO_EMAIL, scope: 'openid' });
    const authReqId = bc.body.auth_req_id;
    const chal = await supertest(app.server).get(`/api/v1/auth/bc-authorize/${authReqId}`);
    expect(chal.status).toBe(200);
    expect(chal.body.challenge).toBeTruthy();
    const poll = await supertest(app.server)
      .post('/api/v1/auth/token').type('form').set('Authorization', basicAuth())
      .send({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: authReqId });
    expect(poll.body.error).toBe('authorization_pending');
  });
});
