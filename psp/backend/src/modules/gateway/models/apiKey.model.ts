/**
 * Integration API keys, as a collection of their own.
 *
 * They used to be an array growing inside the merchant's agreement document. Two problems with that,
 * and the second is the one that matters: an unbounded array inside a document that is read on every
 * merchant lookup, and a credential store embedded in a commercial record, so no consumer could
 * verify a key without loading the merchant.
 *
 * One document per key also makes revocation, last-used tracking and expiry ordinary writes rather
 * than positional updates into an array.
 */
export const API_KEY_COLLECTION = 'apiKey';

export interface ApiKeyRecord {
  keyId: string;
  /** First characters, for display. Never enough to reconstruct the key. */
  keyPrefix: string;
  /**
   * bcrypt of the full plaintext key. The plaintext is never stored.
   *
   * bcrypt is salted, so a presented key cannot be looked up by its hash: verification loads the
   * owner's active keys and compares. That is unchanged here deliberately, because changing the
   * verification algorithm and moving the collection in one step would make a behavioural change
   * look like a mechanical one.
   */
  keyHashBcrypt: string;
  keyStatus: 'active' | 'revoked';
  keyCreatedDateTime: Date;
  keyLastUsedDateTime?: Date;
  /** A human label to tell keys apart. Never a secret. */
  keyLabel?: string;
  /** `generated` was minted here; `imported` came from the merchant's own system. Display only. */
  keyOrigin?: 'generated' | 'imported';

  /** The commercial record this key belongs to. One way, like the client registry's. */
  merchantAgreementInstanceReference: string;

  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

/** What may be returned over the API. The hash is not a display value. */
export interface ApiKeyPublic {
  keyId: string;
  keyPrefix: string;
  keyStatus: ApiKeyRecord['keyStatus'];
  keyCreatedDateTime: Date;
  keyLastUsedDateTime?: Date;
  keyLabel?: string;
  keyOrigin?: ApiKeyRecord['keyOrigin'];
}

export function toPublicApiKey(record: ApiKeyRecord): ApiKeyPublic {
  return {
    keyId: record.keyId,
    keyPrefix: record.keyPrefix,
    keyStatus: record.keyStatus,
    keyCreatedDateTime: record.keyCreatedDateTime,
    ...(record.keyLastUsedDateTime ? { keyLastUsedDateTime: record.keyLastUsedDateTime } : {}),
    ...(record.keyLabel ? { keyLabel: record.keyLabel } : {}),
    ...(record.keyOrigin ? { keyOrigin: record.keyOrigin } : {}),
  };
}
