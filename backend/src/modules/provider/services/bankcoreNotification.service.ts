import { Db } from 'mongodb';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import { getProviderBaseUrl } from './providerAccessToken.service';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../gateway/models/payoutAccount.model';

// The PSP as the RECEIVER of the bank's notifications.
//
// Verification is done properly, against the bank's published key set, because this is the half of the
// boundary that has to survive being pointed at a real ASPSP. There is no shortcut for "our own bank": a
// branch keyed on which bank sent it is exactly what the design forbids, and it would be the first thing
// to break when a second one is registered.

const JWKS_CACHE_MS = 300_000;
const FETCH_TIMEOUT_MS = 4000;

interface JsonWebKey { kty?: string; n?: string; e?: string; kid?: string; alg?: string }

let jwksCache: { keys: JsonWebKey[]; fetchedAtMs: number; source: string } | null = null;

/** For tests, and for a key rotation taking effect without a restart. */
export function resetJwksCache(): void {
  jwksCache = null;
}

export type JwksFetcher = (url: string) => Promise<{ keys: JsonWebKey[] } | null>;

const defaultJwksFetcher: JwksFetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) return null;
  return await response.json() as { keys: JsonWebKey[] };
};

async function loadJwks(
  db: Db,
  fetcher: JwksFetcher,
): Promise<{ keys: JsonWebKey[]; source: string } | { error: string }> {
  if (jwksCache && Date.now() - jwksCache.fetchedAtMs < JWKS_CACHE_MS) return jwksCache;

  // The key set lives where the bank does, and the bank's address comes from the provider record: one
  // source of truth for "which bank", so a token cannot be verified against a different bank's keys.
  const { baseUrl, error } = await getProviderBaseUrl('account_information', { db });
  if (!baseUrl) return { error: `no bank endpoint configured: ${error}` };

  const source = `${baseUrl}/.well-known/jwks.json`;
  try {
    const document = await fetcher(source);
    if (!document?.keys?.length) return { error: `no keys published at ${source}` };
    jwksCache = { keys: document.keys, fetchedAtMs: Date.now(), source };
    return jwksCache;
  } catch (err) {
    return { error: `key set unreachable at ${source}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface VerifiedNotification {
  eventId: string;
  eventType: string;
  subjectReference: string;
  status: string;
  detail: Record<string, unknown>;
  correlationId?: string;
  issuer?: string;
}

export type VerificationResult =
  | { ok: true; notification: VerifiedNotification }
  | { ok: false; status: 400 | 401; error: string };

/**
 * Verifies a Security Event Token and extracts what it says.
 *
 * The signature is checked against the published key, matched by `kid` when the token names one. An
 * unsigned or wrongly signed token is refused: this endpoint is reachable without a platform session, so
 * the signature IS the authentication.
 */
export async function verifyNotification(
  db: Db,
  token: string,
  options: { jwksFetcher?: JwksFetcher; expectedAudience?: string } = {},
): Promise<VerificationResult> {
  if (!token?.trim()) return { ok: false, status: 400, error: 'empty token' };

  const loaded = await loadJwks(db, options.jwksFetcher ?? defaultJwksFetcher);
  if ('error' in loaded) {
    // A key set that cannot be read is not a bad token: answering 401 would tell the bank to stop
    // retrying, when retrying is exactly what should happen.
    return { ok: false, status: 400, error: loaded.error };
  }

  const header = (() => {
    try {
      return JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()) as { kid?: string; alg?: string };
    } catch {
      return {} as { kid?: string; alg?: string };
    }
  })();
  const candidates = header.kid
    ? loaded.keys.filter((key) => key.kid === header.kid)
    : loaded.keys;
  if (candidates.length === 0) {
    return { ok: false, status: 401, error: `no published key matches kid ${header.kid}` };
  }

  let payload: JwtPayload | null = null;
  let failure = 'signature did not verify against any published key';
  for (const key of candidates) {
    try {
      const publicKey = createPublicKey({ key: key as never, format: 'jwk' });
      payload = jwt.verify(token, publicKey, {
        // Pinned: accepting whatever the token asks for is how `alg: none` and HMAC confusion happen.
        algorithms: ['RS256'],
        ...(options.expectedAudience ? { audience: options.expectedAudience } : {}),
      }) as JwtPayload;
      break;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  if (!payload) return { ok: false, status: 401, error: failure };

  const events = (payload.events ?? {}) as Record<string, Record<string, unknown>>;
  const [eventUri] = Object.keys(events);
  if (!eventUri) return { ok: false, status: 400, error: 'the token carries no events claim' };
  const body = events[eventUri] ?? {};
  const subject = (body.subject as { reference?: string } | undefined)?.reference
    ?? (payload.sub as string | undefined);
  if (!subject) return { ok: false, status: 400, error: 'the event names no subject' };

  return {
    ok: true,
    notification: {
      eventId: (payload.jti as string) ?? '',
      // The last path segment of the event URI is the type. Read from the URI rather than trusted from a
      // separate field, so a token cannot claim one type and carry another.
      eventType: eventUri.split('/').pop() ?? eventUri,
      subjectReference: subject,
      status: String(body.status ?? ''),
      detail: body,
      correlationId: payload.txn as string | undefined,
      issuer: payload.iss as string | undefined,
    },
  };
}

// ── What the PSP does with each notification ─────────────────────────────────────────────────────

// The consent statuses that leave a link usable. Everything else deactivates it, including a value this
// code has never seen: an unknown status from a bank is not a reason to keep reading its accounts.
const USABLE_CONSENT_STATUS = 'valid';

export interface AppliedNotification {
  eventType: string;
  applied: boolean;
  detail: string;
  // The event to re-emit on the PSP's own bus, so the existing processes keep working unchanged.
  busEvent?: { name: string; payload: Record<string, unknown> };
}

/**
 * Applies a consent status change to the links that depend on it.
 *
 * Deactivation happens WHEN THE NOTIFICATION ARRIVES, not on the next failed call: a link the customer
 * revoked should stop looking usable immediately, and the projection already refuses to invent a balance.
 */
export async function applyConsentStatusChange(
  db: Db,
  notification: VerifiedNotification,
): Promise<AppliedNotification> {
  const usable = notification.status === USABLE_CONSENT_STATUS;

  // One update per document, NOT `updateMany`: Queryable Encryption rejects a multi-document update
  // outright ("Multi-document updates are not allowed with Queryable Encryption"), and this collection is
  // encrypted. The same application-side pattern the joins use, for the same reason.
  const collection = db.collection(PAYOUT_ACCOUNT_COLLECTION);
  const affected = await collection
    .find(
      { payoutAccountConsentReference: notification.subjectReference },
      { projection: { _id: 0, payoutAccountInstanceReference: 1 } },
    )
    .toArray();
  const now = new Date();
  let modified = 0;
  for (const link of affected) {
    const result = await collection.updateOne(
      { payoutAccountInstanceReference: link.payoutAccountInstanceReference },
      {
        $set: {
          payoutAccountConsentStatus: notification.status,
          payoutAccountConsentStatusChangedDateTime: now,
          recordUpdatedDateTime: now,
        },
      },
    );
    modified += result.modifiedCount;
  }

  return {
    eventType: notification.eventType,
    applied: true,
    detail: `${modified} link(s) marked ${notification.status}${usable ? '' : ' (not usable)'}`,
    busEvent: {
      // A PSP-side name, since this is the PSP's bus. The bank's event stays in the delivery log.
      name: usable ? 'bank.consent.valid' : 'bank.consent.unusable',
      payload: {
        consentReference: notification.subjectReference,
        consentStatus: notification.status,
        reason: notification.detail.reason,
      },
    },
  };
}

// ISO 20022 statuses that mean the money moved, and the ones that mean it will not. `ACSP` and the rest
// are in flight, so they update nothing and hold nothing: reporting progress as an outcome is how a
// payment ends up marked settled before it is.
const SETTLED_STATUSES = new Set(['ACSC']);
const FAILED_STATUSES = new Set(['RJCT', 'CANC']);

/**
 * Turns a payment status change into the event the PSP's own orchestration already listens for.
 *
 * `bank.transfer.settled` is what `payoutOrchestration` subscribes to, and it used to be raised in
 * process by the built-in engine. Re-emitting it here is what keeps that process working unchanged once
 * the engine lives in another service, which is the whole reason this boundary is a webhook.
 */
export function mapPaymentStatusChange(notification: VerifiedNotification): AppliedNotification {
  const status = notification.status;
  if (SETTLED_STATUSES.has(status)) {
    return {
      eventType: notification.eventType,
      applied: true,
      detail: `settled, re-emitted as bank.transfer.settled`,
      busEvent: {
        name: 'bank.transfer.settled',
        // The payload has to be the shape the EXISTING subscriber reads, which is
        // `paymentExecutionInstanceReference`. The bank knows our reference as the end to end id, so that is
        // what it maps to.
        //
        // Found by a live run: without this the event fired, the subscriber looked up `undefined`, returned
        // silently, and the transfer sat in `in_flight` forever. Exactly the "a missing notification leaves a
        // transfer pending in silence" failure this boundary was warned about, and no test would have caught
        // it, because both halves were individually correct.
        payload: {
          paymentExecutionInstanceReference: notification.detail.endToEndIdentification,
          aspspPaymentReference: notification.subjectReference,
          railRef: String(notification.subjectReference),
          completedAt: new Date().toISOString(),
          transactionStatus: status,
        },
      },
    };
  }
  if (FAILED_STATUSES.has(status)) {
    return {
      eventType: notification.eventType,
      applied: true,
      detail: `${status}, re-emitted as bank.transfer.failed`,
      busEvent: {
        name: 'bank.transfer.failed',
        payload: {
          paymentExecutionInstanceReference: notification.detail.endToEndIdentification,
          aspspPaymentReference: notification.subjectReference,
          transactionStatus: status,
          reason: notification.detail.reason,
        },
      },
    };
  }
  // Recorded, not acted on. An in-flight status is news but not an outcome.
  return {
    eventType: notification.eventType,
    applied: true,
    detail: `${status} noted, no terminal action`,
  };
}
