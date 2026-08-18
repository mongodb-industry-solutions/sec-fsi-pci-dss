// v37 P4.2/P4.3: the PSP receives the bank's notifications.
//
// This is the half of the boundary that has to survive being pointed at a real ASPSP, so the verification
// is tested as an adversary would probe it: a wrong key, a wrong algorithm, no signature at all, a token
// naming a key that was never published. There is deliberately no shortcut for "our own bank", because a
// branch keyed on which bank sent it is the first thing that breaks when a second one is registered.
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import type { Db } from 'mongodb';
import {
  verifyNotification, applyConsentStatusChange, mapPaymentStatusChange, resetJwksCache,
} from '../../../../backend/src/modules/provider/services/bankcoreNotification.service';

const BANK_URL = 'http://bank:8083';

// A key pair standing in for the bank's, and a second one that must never verify anything.
const bank = generateKeyPairSync('rsa', { modulusLength: 2048 });
const impostor = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwks(keyPair: typeof bank, kid = 'bank-key-1') {
  // `publicKey` is already a public KeyObject; passing it back through createPublicKey rejects it.
  const jwk = keyPair.publicKey.export({ format: 'jwk' }) as Record<string, string>;
  return { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
}

const provider = {
  externalProviderArrangementInstanceReference: 'int-internal-ais-001',
  externalProviderArrangementType: 'account_information',
  externalProviderArrangementStatus: 'active',
  externalProviderBaseUrl: BANK_URL,
  authConfig: {
    scheme: 'oauth2_cc',
    oauth2: { clientId: 'leafypay-psp', tokenEndpoint: `${BANK_URL}/v1/oauth/token`, scopes: ['accounts'] },
  },
};

// The provider lookup plus the payout account collection, which is the only thing the apply step touches.
function fakeDb(links: Array<Record<string, unknown>> = []) {
  const updates: Array<{ ref: unknown; set: Record<string, unknown> }> = [];
  const collection = (name: string) => ({
    find(filter: Record<string, unknown> = {}) {
      if (name === 'externalProviderArrangement') return { async toArray() { return [provider]; } };
      const matched = links.filter((l) => l.payoutAccountConsentReference === filter.payoutAccountConsentReference);
      return { async toArray() { return matched; } };
    },
    // updateOne, never updateMany: Queryable Encryption rejects a multi-document update on an encrypted
    // collection, which is how the live run found this. A fake offering updateMany would hide it.
    async updateOne(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      updates.push({ ref: filter.payoutAccountInstanceReference, set: update.$set ?? {} });
      return { modifiedCount: 1 };
    },
  });
  return { db: { collection } as unknown as Db, updates };
}

function signed(claims: Record<string, unknown>, keyPair = bank, options: jwt.SignOptions = {}) {
  return jwt.sign(claims, keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), {
    algorithm: 'RS256', keyid: 'bank-key-1', ...options,
  });
}

const CONSENT_TOKEN = () => signed({
  jti: 'evt-1',
  iss: BANK_URL,
  aud: 'leafypay-psp',
  sub: 'cns-1',
  txn: 'X-1',
  events: {
    'https://leafypay.example/secevent/consent.status.changed': {
      subject: { reference: 'cns-1' }, status: 'revokedByPsu', reason: 'customer_revoked',
    },
  },
});

const fetcher = (document: unknown) => async () => document as never;

beforeEach(() => resetJwksCache());

describe('v37 P4.2: verification against the published key set', () => {
  it('accepts a token the bank signed, and reads the event from its URI', async () => {
    const result = await verifyNotification(fakeDb().db, CONSENT_TOKEN(), { jwksFetcher: fetcher(jwks(bank)) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toMatchObject({
      eventId: 'evt-1',
      // Read from the URI rather than a separate field, so a token cannot claim one type and carry another.
      eventType: 'consent.status.changed',
      subjectReference: 'cns-1',
      status: 'revokedByPsu',
      correlationId: 'X-1',
    });
  });

  it('REFUSES a token signed by anyone else', async () => {
    const token = signed({ jti: 'evt-2', sub: 'cns-1', events: { 'x/consent.status.changed': { status: 'valid' } } }, impostor);
    const result = await verifyNotification(fakeDb().db, token, { jwksFetcher: fetcher(jwks(bank)) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('refuses an unsigned token, so `alg: none` is not a way in', async () => {
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.`
      + `${Buffer.from(JSON.stringify({ jti: 'evt-3', sub: 'cns-1', events: { 'x/consent.status.changed': {} } })).toString('base64url')}.`;
    const result = await verifyNotification(fakeDb().db, unsigned, { jwksFetcher: fetcher(jwks(bank)) });
    expect(result.ok).toBe(false);
  });

  it('refuses an HMAC token even when the secret is the published modulus', async () => {
    // Algorithm confusion: a verifier that trusts the header would accept this. RS256 is pinned.
    const jwkSet = jwks(bank);
    const token = jwt.sign({ jti: 'evt-4', sub: 'cns-1', events: { 'x/consent.status.changed': {} } }, jwkSet.keys[0].n!, { algorithm: 'HS256', keyid: 'bank-key-1' });
    const result = await verifyNotification(fakeDb().db, token, { jwksFetcher: fetcher(jwkSet) });
    expect(result.ok).toBe(false);
  });

  it('refuses a token naming a key that was never published', async () => {
    const token = signed({ jti: 'evt-5', sub: 'cns-1', events: { 'x/consent.status.changed': {} } }, bank, { keyid: 'some-other-key' });
    const result = await verifyNotification(fakeDb().db, token, { jwksFetcher: fetcher(jwks(bank)) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('kid');
  });

  it('refuses an expired token', async () => {
    const token = signed({ jti: 'evt-6', sub: 'cns-1', events: { 'x/consent.status.changed': {} } }, bank, { expiresIn: -10 });
    const result = await verifyNotification(fakeDb().db, token, { jwksFetcher: fetcher(jwks(bank)) });
    expect(result.ok).toBe(false);
  });

  it('refuses a token with no events claim, and one with no subject', async () => {
    const noEvents = signed({ jti: 'evt-7', sub: 'cns-1' });
    expect((await verifyNotification(fakeDb().db, noEvents, { jwksFetcher: fetcher(jwks(bank)) })).ok).toBe(false);
    const noSubject = signed({ jti: 'evt-8', events: { 'x/consent.status.changed': { status: 'valid' } } });
    expect((await verifyNotification(fakeDb().db, noSubject, { jwksFetcher: fetcher(jwks(bank)) })).ok).toBe(false);
  });

  it('answers 400, not 401, when OUR key set lookup fails', async () => {
    const failing = async () => { throw new Error('connect ECONNREFUSED'); };
    const result = await verifyNotification(fakeDb().db, CONSENT_TOKEN(), { jwksFetcher: failing as never });
    expect(result.ok).toBe(false);
    // 401 tells the bank to stop retrying; retrying is exactly what should happen while we are broken.
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('caches the key set, so a burst of notifications is not a burst of fetches', async () => {
    let fetches = 0;
    const counting = async () => { fetches += 1; return jwks(bank) as never; };
    await verifyNotification(fakeDb().db, CONSENT_TOKEN(), { jwksFetcher: counting });
    await verifyNotification(fakeDb().db, CONSENT_TOKEN(), { jwksFetcher: counting });
    expect(fetches).toBe(1);
  });
});

describe('v37 P4.3: what each event does to the PSP', () => {
  const consentNotification = {
    eventId: 'evt-1', eventType: 'consent.status.changed', subjectReference: 'cns-1',
    status: 'revokedByPsu', detail: { reason: 'customer_revoked' },
  };

  it('marks every link on a revoked consent, one update at a time', async () => {
    const bankDb = fakeDb([
      { payoutAccountInstanceReference: 'pau-1', payoutAccountConsentReference: 'cns-1' },
      { payoutAccountInstanceReference: 'pau-2', payoutAccountConsentReference: 'cns-1' },
    ]);
    const applied = await applyConsentStatusChange(bankDb.db, consentNotification);
    expect(applied.detail).toContain('2 link(s)');
    expect(bankDb.updates.map((u) => u.ref)).toEqual(['pau-1', 'pau-2']);
    expect(bankDb.updates[0].set.payoutAccountConsentStatus).toBe('revokedByPsu');
    // Deactivation happens when the notification arrives, not on the next failed call.
    expect(applied.busEvent?.name).toBe('bank.consent.unusable');
  });

  it('treats an unknown status as unusable, since a bank we do not understand is not a bank to read', async () => {
    const bankDb = fakeDb([{ payoutAccountInstanceReference: 'pau-1', payoutAccountConsentReference: 'cns-1' }]);
    const applied = await applyConsentStatusChange(bankDb.db, { ...consentNotification, status: 'someFutureStatus' });
    expect(applied.busEvent?.name).toBe('bank.consent.unusable');
  });

  it('re-emits a settled payment under the name the existing orchestration listens for', () => {
    const applied = mapPaymentStatusChange({
      eventId: 'evt-9', eventType: 'payment.status.changed', subjectReference: 'pmt-1',
      status: 'ACSC', detail: { endToEndIdentification: 'PSP-PAY-1' },
    });
    // `bank.transfer.settled` is what payoutOrchestration subscribes to, and it used to be raised in
    // process by the built-in engine. Renaming it would leave transfers pending in silence.
    expect(applied.busEvent).toMatchObject({
      name: 'bank.transfer.settled',
      // Our reference under the name the subscriber reads, the bank's carried alongside.
      payload: { paymentExecutionInstanceReference: 'PSP-PAY-1', aspspPaymentReference: 'pmt-1' },
    });
  });

  it('names the payload field the EXISTING subscriber reads, not a new one', () => {
    const applied = mapPaymentStatusChange({
      eventId: 'evt-10', eventType: 'payment.status.changed', subjectReference: 'pmt-bank-1',
      status: 'ACSC', detail: { endToEndIdentification: 'psp-exec-1' },
    });
    // `payoutOrchestration` reads `paymentExecutionInstanceReference`. A live run found that a payload using
    // any other name fires the event, has the subscriber look up `undefined`, return silently, and leave the
    // transfer in `in_flight` forever. Both halves were individually correct, which is why only an end to end
    // run caught it.
    expect(applied.busEvent!.payload.paymentExecutionInstanceReference).toBe('psp-exec-1');
    // The bank's own id is carried alongside, not in place of ours.
    expect(applied.busEvent!.payload.aspspPaymentReference).toBe('pmt-bank-1');
  });

  it('re-emits a rejected or cancelled payment as failed', () => {
    for (const status of ['RJCT', 'CANC']) {
      const applied = mapPaymentStatusChange({
        eventId: 'e', eventType: 'payment.status.changed', subjectReference: 'pmt-2', status, detail: {},
      });
      expect(applied.busEvent?.name, status).toBe('bank.transfer.failed');
    }
  });

  it('does NOT treat an in-flight status as an outcome', () => {
    for (const status of ['RCVD', 'ACTC', 'ACCP', 'ACSP', 'PDNG']) {
      const applied = mapPaymentStatusChange({
        eventId: 'e', eventType: 'payment.status.changed', subjectReference: 'pmt-3', status, detail: {},
      });
      // Reporting progress as an outcome is how a payment ends up marked settled before it is.
      expect(applied.busEvent, status).toBeUndefined();
      expect(applied.detail).toContain(status);
    }
  });
});
