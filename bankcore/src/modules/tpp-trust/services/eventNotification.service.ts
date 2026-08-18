import { Db } from 'mongodb';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_WEBHOOK_DELIVERY_LOG_COLLECTION,
  TppEventSubscriptionControlRecord, TppWebhookDeliveryLogRecord, TppEventType, DeliveryOutcome,
} from '../models/tppEventSubscription.model';
import { signingKey } from './bankSigningKey.service';
import { config } from '../../../config';

// Event notification: a Security Event Token (RFC 8417) delivered push style (RFC 8935).
//
// Why this and not a bus: in-process buses in two processes cannot see each other, so the settlement the
// PSP used to receive as a local event has to arrive over HTTP once the bank is a separate service. This
// is also how a real bank behaves, and it needs no broker to run.
//
// Why a signed JWS and not an HMAC: the receiver has to verify a signature against a published key set,
// because that is what it will do against a real ASPSP. The PSP to merchant direction keeps HMAC, which is
// right for a small integrator; the two directions differ deliberately.
const TIMEOUT_MS = 4000;

// The event URIs the token carries. A stable namespace of ours, since no register defines a "consent
// status changed" URI, and the alternative (a bare string) would be indistinguishable from a typo.
const EVENT_URI_PREFIX = 'https://leafypay.example/secevent';

export interface NotificationInput {
  eventType: TppEventType;
  // The resource that changed, and its new status. Both go in the token AND in the delivery log, so a
  // missed delivery can be reconstructed from either side.
  subjectReference: string;
  status: string;
  // Extra facts the receiver needs to act without calling back. Kept small on purpose.
  detail?: Record<string, unknown>;
  correlationId?: string;
}

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  attempts: number;
  detail?: string;
  eventId: string;
}

function eventUri(eventType: TppEventType): string {
  return `${EVENT_URI_PREFIX}/${eventType}`;
}

/**
 * Builds the signed Security Event Token. Separate from delivery so the token can be asserted on without
 * a network, which is the only way to test that what the bank signs is what a receiver can verify.
 */
export function buildSecurityEventToken(
  subscription: TppEventSubscriptionControlRecord,
  input: NotificationInput,
  eventId = `evt-${uuidv4()}`,
): string {
  const { privateKey, keyId } = signingKey();
  const claims = {
    // `jti` is what makes a redelivery idempotent for the receiver: same event, same id.
    jti: eventId,
    iat: Math.floor(Date.now() / 1000),
    iss: config.server.baseUrl,
    aud: subscription.tppRegistrationClientId,
    // The subject of the security event, as the resource it is about.
    sub: input.subjectReference,
    txn: input.correlationId,
    events: {
      [eventUri(input.eventType)]: {
        subject: { reference: input.subjectReference },
        status: input.status,
        ...(input.detail ?? {}),
      },
    },
  };
  return jwt.sign(claims, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), {
    algorithm: subscription.tppEventSubscriptionSigningAlgorithm,
    keyid: keyId,
  });
}

async function recordDelivery(
  db: Db,
  subscription: TppEventSubscriptionControlRecord,
  input: NotificationInput,
  attempt: number,
  outcome: DeliveryOutcome,
  eventId: string,
  responseCode?: number,
  detail?: string,
): Promise<void> {
  const record: TppWebhookDeliveryLogRecord = {
    tppWebhookDeliveryLogInstanceReference: `wdl-${uuidv4()}`,
    tppEventSubscriptionInstanceReference: subscription.tppEventSubscriptionInstanceReference,
    tppRegistrationClientId: subscription.tppRegistrationClientId,
    tppEventType: input.eventType,
    tppEventSubjectReference: input.subjectReference,
    tppEventStatus: input.status,
    deliveryEndpoint: subscription.tppEventSubscriptionCallbackUrl,
    deliveryAttempt: attempt,
    deliveryOutcome: outcome,
    deliveryResponseCode: responseCode,
    deliveryDetail: detail,
    deliveryEventId: eventId,
    deliveryCorrelationId: input.correlationId,
    recordCreatedDateTime: new Date().toISOString(),
    schemaVersion: 1,
  };
  await db.collection<TppWebhookDeliveryLogRecord>(TPP_WEBHOOK_DELIVERY_LOG_COLLECTION).insertOne(record);
}

export async function findSubscription(
  db: Db,
  clientId: string,
  eventType: TppEventType,
): Promise<TppEventSubscriptionControlRecord | null> {
  return db.collection<TppEventSubscriptionControlRecord>(TPP_EVENT_SUBSCRIPTION_COLLECTION).findOne(
    {
      tppRegistrationClientId: clientId,
      tppEventSubscriptionActive: true,
      // A subscription that does not list the event is not a subscription for it: notifying anyway would
      // send a TPP something it never asked to receive.
      tppEventSubscriptionEventTypes: eventType,
    },
    { projection: { _id: 0 } },
  );
}

/**
 * Delivers one notification, retrying per the subscription's policy, and writing a log row per attempt.
 *
 * It never throws. A notification is a side effect of something that already happened: failing the
 * original operation because the bank could not tell anyone would be the wrong trade, and the status
 * endpoint is the specification's own answer to a missed delivery.
 */
export async function notifyTpp(
  db: Db,
  clientId: string,
  input: NotificationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryResult> {
  const eventId = `evt-${uuidv4()}`;
  let subscription: TppEventSubscriptionControlRecord | null = null;
  try {
    subscription = await findSubscription(db, clientId, input.eventType);
  } catch (err) {
    return { outcome: 'failed', attempts: 0, eventId, detail: `subscription lookup failed: ${String(err)}` };
  }
  if (!subscription) {
    // Nothing to deliver to is not a failure, but it IS worth seeing: a consent changing status with no
    // subscription is exactly the silence this collection exists to make visible. There is no row to write
    // it against, so the caller gets it back.
    return { outcome: 'skipped', attempts: 0, eventId, detail: `no active subscription for ${input.eventType}` };
  }

  const token = buildSecurityEventToken(subscription, input, eventId);
  const maxAttempts = Math.max(1, subscription.tppEventSubscriptionRetryPolicy?.maxAttempts ?? 1);
  const backoffMs = subscription.tppEventSubscriptionRetryPolicy?.backoffMs ?? 0;
  let detail: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(subscription.tppEventSubscriptionCallbackUrl, {
        method: 'POST',
        headers: {
          // RFC 8935: a push delivery carries the token as the body with this media type.
          'Content-Type': 'application/secevent+jwt',
          Accept: 'application/json',
          // Berlin Group's correlation header, so one id ties the notification to what caused it.
          'X-Request-ID': input.correlationId ?? eventId,
        },
        body: token,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const outcome: DeliveryOutcome = response.ok ? 'delivered' : 'failed';
      detail = response.ok ? undefined : `receiver answered ${response.status}`;
      await recordDelivery(db, subscription, input, attempt, outcome, eventId, response.status, detail);
      if (response.ok) return { outcome, attempts: attempt, eventId };
    } catch (err) {
      detail = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
      await recordDelivery(db, subscription, input, attempt, 'failed', eventId, undefined, detail);
    }
    // A fixed backoff, not exponential: with a handful of attempts against an in-cluster service the
    // difference is noise, and a simple policy is one an operator can predict.
    if (attempt < maxAttempts && backoffMs > 0) {
      await new Promise((done) => setTimeout(done, backoffMs));
    }
  }
  return { outcome: 'failed', attempts: maxAttempts, eventId, detail };
}
