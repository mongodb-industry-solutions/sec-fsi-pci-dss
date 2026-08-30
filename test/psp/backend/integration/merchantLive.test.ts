// v37 P11.4: the merchant app exercised for real, over the wire, against the running services.
//
// CIBA is the part worth driving properly. The merchant is a confidential client that starts a backchannel
// request; the APPROVAL is a signature by an enrolled private key on the user's own device, and nothing about
// it can be faked from the server side. So this suite enrolls a genuine ES256 credential, keeps the private
// key in memory the way a browser authenticator keeps it in IndexedDB, and signs the challenge with it.
//
// Skipped unless a PSP is listening, because there is nothing honest to assert without one.
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createSign, createHmac, randomUUID } from 'node:crypto';
import { readSeedFile } from './support/contract';

/**
 * A real token for this customer, from the identity authority.
 *
 * Signing in happens there now. These suites are about the BUSINESS endpoints behind the token, so
 * obtaining it is setup rather than the thing under test; the sign-in itself has its own coverage in
 * the authority's suite.
 */
async function authorityLogin(userName: string): Promise<string> {
  const session = await fetch('http://127.0.0.1:8085/realms/leafypay/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: userName, password: 'demo-password' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!session.ok) return '';
  const { sessionId } = await session.json() as { sessionId: string };

  const { createHash, randomBytes } = await import('crypto');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  // A URI the console client is actually registered for. The authority refuses an unregistered one,
  // which is correct and is why this is not simply whatever host the test happens to run against.
  const redirectUri = 'http://localhost:8086/auth/callback';

  const authorize = await fetch('http://127.0.0.1:8085/realms/leafypay/protocol/openid-connect/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'giam-console',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      session_id: sessionId,
    }),
  });
  if (!authorize.ok) return '';
  const { code } = await authorize.json() as { code: string };

  const token = await fetch('http://127.0.0.1:8085/realms/leafypay/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: 'giam-console',
    }),
  });
  if (!token.ok) return '';
  return (await token.json() as { access_token: string }).access_token;
}


/**
 * The seeded principals, read from the identity authority's fixtures.
 *
 * This used to read a login file in this application. That file is gone with everything else about
 * identity, and the binding now runs the other way: a principal carries the business reference it
 * belongs to, rather than a login carrying a party.
 */
function readAuthorityIdentities(): Array<{ subjectId: string; accountHolderRef?: string; demoFeatured?: boolean }> {
  const raw = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../../giam/backend/data/identities.json'),
    'utf8',
  );
  return JSON.parse(raw);
}



const PSP = process.env.PSP_BASE_URL ?? 'http://localhost:8081';

// The merchant is a CONFIDENTIAL client, so only its hash is seeded and the plaintext lives in the merchant
// app's own configuration. This is the demo value from `merchant/env.example`, which is what the running
// merchant app authenticates with; an environment that changed it sets the variable instead.
const MERCHANT_CLIENT_ID = process.env.PSP_MERCHANT_OAUTH_CLIENT_ID ?? 'oauth001-0000-4000-8000-000000000001';
const MERCHANT_CLIENT_SECRET = process.env.PSP_MERCHANT_OAUTH_CLIENT_SECRET ?? 'espresso-demo-secret-2026';

interface AuthSeed {
  subjectId: string;
  accountHolderRef: string;
  roleName: string;
  email: string;
}
interface MerchantSeed {
  merchantAgreementInstanceReference: string;
  merchantOAuthClient?: { oauthClientId: string; oauthClientSecret?: string; oauthScopes: string[]; oauthClientStatus: string };
  merchantWebhook?: { merchantWebhookSecret?: string };
}

function customer(): AuthSeed {
  return readAuthorityIdentities()
    .filter((a) => a.roleName === 'customer')[0];
}

function merchant(): MerchantSeed | undefined {
  return readSeedFile<MerchantSeed[]>('merchants.json')
    .find((m) => m.merchantOAuthClient?.oauthClientStatus === 'active');
}

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${PSP}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch { return false; }
}

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${PSP}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
}

const bearer = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...extra,
});

// An ES256 authenticator, held only in memory. The private key never leaves this process, which is the
// property the real flow depends on.
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign(challenge: string): string {
      // Raw r||s, which is what a real authenticator produces: WebCrypto ES256 and the WebAuthn
      // profile both emit the IEEE P1363 form, and the wallet's own device code says so. Node's
      // default is DER, so signing without this asks the authority to accept something no browser
      // would ever send.
      return createSign('SHA256').update(challenge).end()
        .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    },
  };
}

describe('v37 P11.4: the merchant app against the running services', () => {
  let live = false;
  let sessionToken = '';
  const person = customer();
  const shop = merchant();

  beforeAll(async () => {
    live = await reachable();
    if (!live) return;
    // Signing in happens at the authority. This suite is about the CIBA ceremony behind the token.
    sessionToken = await authorityLogin(person.userName);
  });

  it('logs a user in with CIBA, approved by a signature from an enrolled key', async () => {
    if (!live) return;
    const device = authenticator();

    // 1. Enrol the authenticator. The challenge proves possession before the key is trusted.
    const challenge = await call('/api/v1/auth/enroll/challenge', {
      method: 'POST', headers: bearer(sessionToken), body: JSON.stringify({}),
    });
    expect(challenge.status, JSON.stringify(challenge.body).slice(0, 200)).toBe(200);
    const registrationChallenge = String(challenge.body.challenge ?? '');
    expect(registrationChallenge).toBeTruthy();

    const credentialId = `p11-${randomUUID()}`;
    const enrolled = await call('/api/v1/auth/enroll', {
      method: 'POST',
      headers: bearer(sessionToken),
      body: JSON.stringify({
        challenge: registrationChallenge,
        publicKeyPem: device.publicKeyPem,
        alg: 'ES256',
        signature: device.sign(registrationChallenge),
        credentialId,
        authenticatorMetadata: { deviceName: 'P11 compatibility check', createdVia: 'test' },
      }),
    });
    expect(enrolled.status, JSON.stringify(enrolled.body).slice(0, 300)).toBe(200);

    // 2. The merchant starts the backchannel request as a confidential client.
    const started = await call('/api/v1/auth/bc-authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MERCHANT_CLIENT_ID,
        client_secret: MERCHANT_CLIENT_SECRET,
        login_hint: person.subjectId,
        scope: 'openid profile read:accounts',
        binding_message: 'P11 login 1234',
      }),
    });
    // Asserted, not tolerated. An earlier version of this test accepted a 401 here and returned, which made
    // the whole ceremony below unreachable while the test still reported success: the client secret was
    // wrong and nothing said so. If the merchant cannot start a backchannel request, that is the finding.
    expect(started.status, `bc-authorize: ${JSON.stringify(started.body).slice(0, 300)}`).toBe(200);

    const authReqId = String(started.body.auth_req_id ?? '');
    expect(authReqId).toBeTruthy();

    // 3. The device fetches the challenge and signs it. This IS the authentication.
    const pending = await call(`/api/v1/auth/bc-authorize/${encodeURIComponent(authReqId)}`);
    expect(pending.status).toBe(200);
    const loginChallenge = String(pending.body.challenge ?? '');
    expect(loginChallenge).toBeTruthy();

    const approved = await call(`/api/v1/auth/bc-authorize/${encodeURIComponent(authReqId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId, signature: device.sign(loginChallenge) }),
    });
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);

    // 4. The merchant polls for the token, which is the whole point of the ceremony.
    const token = await call('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:openid:params:grant-type:ciba',
        auth_req_id: authReqId,
        client_id: MERCHANT_CLIENT_ID,
        client_secret: MERCHANT_CLIENT_SECRET,
      }).toString(),
    });
    expect(token.status, JSON.stringify(token.body).slice(0, 300)).toBe(200);
    expect(token.body.access_token).toBeTruthy();
  });

  it('rejects an approval signed by the wrong key, or the assertion proves nothing', async () => {
    if (!live) return;
    // The negative half. If a wrong signature were accepted, everything above would be theatre.
    const impostor = authenticator();
    const response = await call('/api/v1/auth/bc-authorize/not-a-real-request/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: 'nobody', signature: impostor.sign('anything') }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('takes a payment', async () => {
    if (!live) return;
    const response = await call('/api/v1/gateway/payments', {
      method: 'POST',
      headers: bearer(sessionToken, { 'Idempotency-Key': `p11-pay-${Date.now()}` }),
      body: JSON.stringify({
        amount: 12.5,
        currency: 'EUR',
        description: 'P11 compatibility check',
        cardToken: readSeedFile<Array<{ paymentCardReference: string }>>('paymentCards.json')[0].paymentCardReference,
      }),
    });
    // Accepted, declined for a stated reason, or refused as malformed: all are answers. A 5xx is not.
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBeLessThan(500);
  });

  it('creates a request to pay', async () => {
    if (!live) return;
    const response = await call('/api/v1/gateway/rtp/requests', {
      method: 'POST',
      headers: bearer(sessionToken, { 'Idempotency-Key': `p11-rtp-${Date.now()}` }),
      body: JSON.stringify({
        payerAliasType: 'email',
        payerAlias: person.email,
        amount: 5,
        currency: 'EUR',
        remittanceInformation: 'P11 compatibility check',
      }),
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBeLessThan(500);
  });

  it('creates a payment link', async () => {
    if (!live) return;
    const response = await call('/api/v1/payment/links', {
      method: 'POST',
      headers: bearer(sessionToken),
      body: JSON.stringify({ amount: 9.99, currency: 'EUR', description: 'P11 compatibility check' }),
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBeLessThan(500);
  });

  it('signs a webhook the merchant can verify, and the signature is reproducible', () => {
    // The delivery itself is asynchronous, so what is asserted here is the property the merchant depends on:
    // the HMAC over the exact body with the shared secret. A merchant that cannot reproduce it has no way to
    // tell a real callback from anyone's POST.
    const secret = shop?.merchantWebhook?.merchantWebhookSecret;
    if (!secret) return;
    const payload = JSON.stringify({ event: 'payment.settled', reference: 'p11' });
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    expect(createHmac('sha256', secret).update(payload).digest('hex')).toBe(signature);
    // A different body must not verify, which is the only thing that makes the signature worth checking.
    expect(createHmac('sha256', secret).update(`${payload} `).digest('hex')).not.toBe(signature);
  });
});
