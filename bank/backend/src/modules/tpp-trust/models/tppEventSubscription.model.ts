// Where the bank delivers its notifications, and the trail of what it delivered.
//
// Modelled on the PSP's merchant webhook trio deliberately (endpoint, event selection, signing, retries,
// plus a per-attempt log), so the same mental model and the same inspector patterns apply on both sides of
// the platform. Configuration lives here, not in the environment: repointing a callback is a data change.
export const TPP_EVENT_SUBSCRIPTION_COLLECTION = 'tppEventSubscription';
export const TPP_WEBHOOK_DELIVERY_LOG_COLLECTION = 'tppWebhookDeliveryLog';

// What the bank notifies about. These are the two facts a TPP cannot discover any other way without
// polling: a consent's status changed, and a payment's status changed.
//
// The names are the standard's resource-and-event shape, not an invented taxonomy: a Security Event Token
// carries an event URI, and these are the bank's own URIs under a stable namespace.
export type TppEventType =
  | 'consent.status.changed'
  | 'payment.status.changed';

export const TPP_EVENT_TYPES: TppEventType[] = ['consent.status.changed', 'payment.status.changed'];

export interface TppEventSubscriptionControlRecord {
  tppEventSubscriptionInstanceReference: string;
  // Which registered TPP this delivers to. A subscription belongs to one client, like a consent does.
  tppRegistrationClientId: string;
  // Absolute URL, written at seed time from the environment. There is no runtime fallback: a silent
  // fallback is how two environments end up disagreeing about where the PSP is.
  tppEventSubscriptionCallbackUrl: string;
  tppEventSubscriptionEventTypes: TppEventType[];
  // Signing configuration. The bank signs a Security Event Token as a JWS and publishes its verification
  // key, so the receiver verifies a signature rather than a shared secret. The algorithm is a field
  // because rotating to a stronger one must not need a code change.
  tppEventSubscriptionSigningAlgorithm: 'RS256';
  // Where the receiver can fetch the bank's public key. Stored so an inspector can show what it told the
  // TPP to trust.
  tppEventSubscriptionJwksUrl: string;
  tppEventSubscriptionActive: boolean;
  tppEventSubscriptionRetryPolicy: {
    maxAttempts: number;
    backoffMs: number;
  };
  bianServiceDomain: string;
  bianControlRecordType: 'TppEventSubscription';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

export type DeliveryOutcome = 'delivered' | 'failed' | 'skipped';

export interface TppWebhookDeliveryLogRecord {
  tppWebhookDeliveryLogInstanceReference: string;
  tppEventSubscriptionInstanceReference: string;
  tppRegistrationClientId: string;
  tppEventType: TppEventType;
  // The resource the event is about, so a delivery can be found from the thing that changed.
  tppEventSubjectReference: string;
  tppEventStatus: string;
  deliveryEndpoint: string;
  deliveryAttempt: number;
  deliveryOutcome: DeliveryOutcome;
  deliveryResponseCode?: number;
  // Why it failed or was skipped. A delivery that silently did not happen is the failure mode this whole
  // collection exists to make visible.
  deliveryDetail?: string;
  // The token's own id (`jti`), which is what makes a delivery idempotent for the receiver.
  deliveryEventId: string;
  deliveryCorrelationId?: string;
  recordCreatedDateTime: string;
  schemaVersion: number;
}
