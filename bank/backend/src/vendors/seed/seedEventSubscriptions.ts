import { Db } from 'mongodb';
import { resolvePlatformLinks, absoluteEndpoint } from '@leafypay/platform-links';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_EVENT_TYPES, TppEventSubscriptionControlRecord,
} from '../../modules/tpp-trust/models/tppEventSubscription.model';
import { jwksUrl } from '../../modules/tpp-trust/services/bankSigningKey.service';
import { config } from '../../config';

// Where the bank delivers its notifications. The environment is read at SEED time to write an absolute
// URL into the record; at runtime only the record is read, with no fallback, because a silent fallback is
// how two environments end up disagreeing about where the PSP is.
//
// The PSP's receiving path. It follows the convention the PSP already uses for provider callbacks rather
// than opening a new path space, since this is the same family: an external system calling back. Only the
// authentication differs (a signed JWS instead of an HMAC). The host is the environment's.
const PSP_CALLBACK_PATH = '/api/v1/providers/callback/bankcore';

export async function seedEventSubscriptions(db: Db): Promise<number> {
  const { pspBaseUrl } = resolvePlatformLinks();
  const record: TppEventSubscriptionControlRecord = {
    tppEventSubscriptionInstanceReference: 'sub-leafypay-001',
    tppRegistrationClientId: config.bank.tppSeedClientId,
    tppEventSubscriptionCallbackUrl: absoluteEndpoint(pspBaseUrl, PSP_CALLBACK_PATH),
    // Every event this bank knows how to raise. A subscription that omits one silently stops delivering
    // it, so the seeded default is everything rather than a subset nobody remembers choosing.
    tppEventSubscriptionEventTypes: [...TPP_EVENT_TYPES],
    tppEventSubscriptionSigningAlgorithm: 'RS256',
    tppEventSubscriptionJwksUrl: jwksUrl(),
    tppEventSubscriptionActive: true,
    // Three attempts with a short fixed backoff: enough to ride out a restart of the receiver, and the
    // status endpoint is the fallback for anything worse.
    tppEventSubscriptionRetryPolicy: { maxAttempts: 3, backoffMs: 500 },
    bianServiceDomain: 'Party Authentication',
    bianControlRecordType: 'TppEventSubscription',
    recordCreatedDateTime: '2026-08-18T00:00:00.000Z',
    schemaVersion: 1,
  };

  await db.collection<TppEventSubscriptionControlRecord>(TPP_EVENT_SUBSCRIPTION_COLLECTION).updateOne(
    { tppEventSubscriptionInstanceReference: record.tppEventSubscriptionInstanceReference },
    { $set: { ...record, recordUpdatedDateTime: new Date().toISOString() } },
    { upsert: true },
  );
  console.log(`  ${TPP_EVENT_SUBSCRIPTION_COLLECTION}: 1 subscription upserted (${record.tppEventSubscriptionCallbackUrl})`);
  return 1;
}
