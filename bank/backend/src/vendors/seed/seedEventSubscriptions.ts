import { Db } from 'mongodb';
import { absoluteEndpoint, linkPlaceholder } from '@leafypay/platform-links';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_EVENT_TYPES, TppEventSubscriptionControlRecord,
} from '../../modules/tpp-trust/models/tppEventSubscription.model';
import { jwksUrl } from '../../modules/tpp-trust/services/bankSigningKey.service';
import { config } from '../../config';

// Where the bank delivers its notifications. The record NAMES the PSP link and the host is bound when
// the notification is delivered, because the same record is restored into local, staging and production
// and the PSP answers on a different host in each (in staging, on an in-cluster name).
//
// The PSP's receiving path. It follows the convention the PSP already uses for provider callbacks rather
// than opening a new path space, since this is the same family: an external system calling back. Only the
// authentication differs (a signed JWS instead of an HMAC).
const PSP_CALLBACK_PATH = '/api/v1/providers/callback/bankcore';

export async function seedEventSubscriptions(db: Db): Promise<number> {
  const record: TppEventSubscriptionControlRecord = {
    tppEventSubscriptionInstanceReference: 'sub-leafypay-001',
    tppRegistrationClientId: config.bank.tppSeedClientId,
    tppEventSubscriptionCallbackUrl: absoluteEndpoint(linkPlaceholder('psp'), PSP_CALLBACK_PATH),
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
