// v37 P3.6/P3.10d/P3.10e: the bank tells its TPP what changed, with a Security Event Token.
//
// The property that matters most is that what the bank SIGNS is what a receiver can VERIFY through the
// published key set. A signing test that verifies with the same private key proves nothing: it has to go
// through the JWKS, because that is the path a real client takes.
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import type { Db } from 'mongodb';
import {
  buildSecurityEventToken, notifyTpp, findSubscription,
} from '../../../../bank/backend/src/modules/tpp-trust/services/eventNotification.service';
import { publicJwks } from '../../../../bank/backend/src/modules/tpp-trust/services/bankSigningKey.service';
import type { TppEventSubscriptionControlRecord } from '../../../../bank/backend/src/modules/tpp-trust/models/tppEventSubscription.model';

const CLIENT = 'leafypay-psp';
const CALLBACK = 'http://127.0.0.1:8081/api/v1/integrations/webhooks/bankcore';

function subscription(overrides: Partial<TppEventSubscriptionControlRecord> = {}): TppEventSubscriptionControlRecord {
  return {
    tppEventSubscriptionInstanceReference: 'sub-leafypay-001',
    tppRegistrationClientId: CLIENT,
    tppEventSubscriptionCallbackUrl: CALLBACK,
    tppEventSubscriptionEventTypes: ['consent.status.changed', 'payment.status.changed'],
    tppEventSubscriptionSigningAlgorithm: 'RS256',
    tppEventSubscriptionJwksUrl: 'http://localhost:8083/.well-known/jwks.json',
    tppEventSubscriptionActive: true,
    tppEventSubscriptionRetryPolicy: { maxAttempts: 3, backoffMs: 0 },
    bianServiceDomain: 'Party Authentication',
    bianControlRecordType: 'TppEventSubscription',
    recordCreatedDateTime: '2026-08-18T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  } as TppEventSubscriptionControlRecord;
}

// The subscription lookup filters on the client, the active flag and membership of the event list, so the
// fake honours exactly those: a fake that ignored the event list would hide the "not subscribed" path.
function fakeDb(subscriptions: TppEventSubscriptionControlRecord[]) {
  const deliveries: Array<Record<string, unknown>> = [];
  const collection = (name: string) => ({
    async findOne(filter: Record<string, unknown>) {
      if (name !== 'tppEventSubscription') return null;
      return subscriptions.find((s) => (
        s.tppRegistrationClientId === filter.tppRegistrationClientId
        && s.tppEventSubscriptionActive === filter.tppEventSubscriptionActive
        && s.tppEventSubscriptionEventTypes.includes(filter.tppEventSubscriptionEventTypes as never)
      )) ?? null;
    },
    async insertOne(doc: Record<string, unknown>) { deliveries.push(doc); return { acknowledged: true }; },
  });
  return { db: { collection } as unknown as Db, deliveries };
}

// Verification exactly as a receiver does it: fetch the key set, build a key from the JWK, verify.
function verifyThroughJwks(token: string): jwt.JwtPayload {
  const jwk = publicJwks().keys[0];
  const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
}

const CONSENT_EVENT = {
  eventType: 'consent.status.changed' as const,
  subjectReference: 'cns-1',
  status: 'valid',
  detail: { reason: 'tpp_registered' },
  correlationId: 'X-NOTIFY-1',
};

let bank: ReturnType<typeof fakeDb>;
beforeEach(() => { bank = fakeDb([subscription()]); });

describe('v37 P3.6: the token the bank signs', () => {
  it('verifies against the PUBLISHED key set, which is the path a real client takes', () => {
    const token = buildSecurityEventToken(subscription(), CONSENT_EVENT, 'evt-1');
    const claims = verifyThroughJwks(token);
    expect(claims.jti).toBe('evt-1');
    expect(claims.aud).toBe(CLIENT);
    expect(claims.sub).toBe('cns-1');
  });

  it('names the key it used, so a receiver can pick the right one after a rotation', () => {
    const token = buildSecurityEventToken(subscription(), CONSENT_EVENT);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(publicJwks().keys[0].kid);
  });

  it('carries the event under its URI, with the new status and its reason', () => {
    const token = buildSecurityEventToken(subscription(), CONSENT_EVENT, 'evt-2');
    const claims = verifyThroughJwks(token);
    const events = claims.events as Record<string, { status: string; reason: string; subject: { reference: string } }>;
    const [uri] = Object.keys(events);
    // A URI rather than a bare name: a typo in a bare string is indistinguishable from a new event type.
    expect(uri).toMatch(/consent\.status\.changed$/);
    expect(events[uri]).toMatchObject({ status: 'valid', reason: 'tpp_registered' });
    expect(events[uri].subject.reference).toBe('cns-1');
  });

  it('is rejected by a receiver holding the wrong key, so the signature is doing work', () => {
    const token = buildSecurityEventToken(subscription(), CONSENT_EVENT);
    // A wrong-but-valid RSA key: verification must fail on the signature, not on the format.
    const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => jwt.verify(token, publicKey, { algorithms: ['RS256'] })).toThrow();
  });
});

describe('v37 P3.6: delivery, and what it records', () => {
  const ok = (async () => ({ ok: true, status: 204 })) as unknown as typeof fetch;

  it('delivers with the media type the push profile defines, and logs the attempt', async () => {
    let seen: { url?: string; headers?: Record<string, string>; body?: string } = {};
    const capturing = (async (url: string, init: Record<string, unknown>) => {
      seen = { url, headers: init.headers as Record<string, string>, body: String(init.body) };
      return { ok: true, status: 202 };
    }) as unknown as typeof fetch;

    const result = await notifyTpp(bank.db, CLIENT, CONSENT_EVENT, capturing);
    expect(result).toMatchObject({ outcome: 'delivered', attempts: 1 });
    expect(seen.url).toBe(CALLBACK);
    expect(seen.headers!['Content-Type']).toBe('application/secevent+jwt');
    // The correlation id travels with it, so one id ties the notification to what caused it.
    expect(seen.headers!['X-Request-ID']).toBe('X-NOTIFY-1');
    // The body IS the token, not a JSON envelope wrapping it.
    expect(seen.body!.split('.').length).toBe(3);
    expect(bank.deliveries.length).toBe(1);
    expect(bank.deliveries[0]).toMatchObject({ deliveryOutcome: 'delivered', deliveryResponseCode: 202 });
  });

  it('retries per the policy and logs EVERY attempt, not just the last', async () => {
    const failing = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const result = await notifyTpp(bank.db, CLIENT, CONSENT_EVENT, failing);
    expect(result).toMatchObject({ outcome: 'failed', attempts: 3 });
    // Three rows, so a retry that eventually succeeded is distinguishable from a first-time success.
    expect(bank.deliveries.length).toBe(3);
    expect(bank.deliveries.map((d) => d.deliveryAttempt)).toEqual([1, 2, 3]);
  });

  it('stops as soon as one attempt succeeds', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      return { ok: calls > 1, status: calls > 1 ? 204 : 500 };
    }) as unknown as typeof fetch;
    const result = await notifyTpp(bank.db, CLIENT, CONSENT_EVENT, flaky);
    expect(result).toMatchObject({ outcome: 'delivered', attempts: 2 });
    expect(calls).toBe(2);
  });

  it('records an unreachable receiver with the reason, not as a silent nothing', async () => {
    const unreachable = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await notifyTpp(bank.db, CLIENT, CONSENT_EVENT, unreachable);
    expect(result.outcome).toBe('failed');
    expect(String(bank.deliveries[0].deliveryDetail)).toContain('ECONNREFUSED');
  });

  it('gives every attempt of one event the SAME id, so a receiver can deduplicate', async () => {
    const failing = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await notifyTpp(bank.db, CLIENT, CONSENT_EVENT, failing);
    const ids = new Set(bank.deliveries.map((d) => d.deliveryEventId));
    expect(ids.size).toBe(1);
  });

  it('skips when there is no subscription, and says so rather than appearing to deliver', async () => {
    const empty = fakeDb([]);
    const result = await notifyTpp(empty.db, CLIENT, CONSENT_EVENT, ok);
    expect(result.outcome).toBe('skipped');
    expect(result.detail).toContain('no active subscription');
  });

  it('skips an INACTIVE subscription and one that does not list the event', async () => {
    const inactive = fakeDb([subscription({ tppEventSubscriptionActive: false })]);
    expect((await notifyTpp(inactive.db, CLIENT, CONSENT_EVENT, ok)).outcome).toBe('skipped');

    const narrow = fakeDb([subscription({ tppEventSubscriptionEventTypes: ['payment.status.changed'] })]);
    // Delivering an event a TPP never asked for is worse than not delivering it.
    expect((await notifyTpp(narrow.db, CLIENT, CONSENT_EVENT, ok)).outcome).toBe('skipped');
  });

  it('never throws, because a notification is a side effect of something that already happened', async () => {
    const broken = { collection: () => ({ async findOne() { throw new Error('no database'); } }) } as unknown as Db;
    const result = await notifyTpp(broken, CLIENT, CONSENT_EVENT, ok);
    expect(result.outcome).toBe('failed');
  });

  it('resolves a subscription only for the client it belongs to', async () => {
    expect(await findSubscription(bank.db, CLIENT, 'consent.status.changed')).not.toBeNull();
    expect(await findSubscription(bank.db, 'someone-else', 'consent.status.changed')).toBeNull();
  });
});
