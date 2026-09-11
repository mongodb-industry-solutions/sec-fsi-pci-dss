import { Db } from 'mongodb';
import { API_KEY_COLLECTION, ApiKeyRecord } from '../models/apiKey.model';

/**
 * The one way anything reads or writes an integration API key.
 *
 * Replaces positional updates into an array embedded in the merchant document
 * (`merchantApiKeys.$.keyStatus` and friends), which are the writes that made the array hard to move
 * and easy to get subtly wrong.
 */

function collection(db: Db) {
  return db.collection<ApiKeyRecord>(API_KEY_COLLECTION);
}

export async function listKeysByOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<ApiKeyRecord[]> {
  return collection(db)
    .find({ merchantAgreementInstanceReference }, { projection: { _id: 0 } })
    .sort({ keyCreatedDateTime: 1 })
    .toArray();
}

export async function listActiveKeysByOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<ApiKeyRecord[]> {
  return collection(db)
    .find({ merchantAgreementInstanceReference, keyStatus: 'active' }, { projection: { _id: 0 } })
    .sort({ keyCreatedDateTime: 1 })
    .toArray();
}

export async function findKey(db: Db, keyId: string): Promise<ApiKeyRecord | null> {
  return collection(db).findOne({ keyId }, { projection: { _id: 0 } });
}

export async function insertKey(db: Db, record: ApiKeyRecord): Promise<void> {
  await collection(db).insertOne(record);
}

export async function countActiveKeys(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<number> {
  return collection(db).countDocuments({ merchantAgreementInstanceReference, keyStatus: 'active' });
}

/** Returns whether a key was actually revoked, so the caller can answer 404 rather than a false 200. */
export async function revokeKey(
  db: Db,
  merchantAgreementInstanceReference: string,
  keyId: string,
): Promise<boolean> {
  const result = await collection(db).updateOne(
    { merchantAgreementInstanceReference, keyId, keyStatus: 'active' },
    { $set: { keyStatus: 'revoked', recordUpdatedDateTime: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function setKeyLabel(
  db: Db,
  merchantAgreementInstanceReference: string,
  keyId: string,
  label: string | null,
): Promise<boolean> {
  // Clearing a label removes the field rather than storing an empty string, so "no label" has one
  // representation instead of two that render differently.
  const update = label === null
    ? { $unset: { keyLabel: 1 as const }, $set: { recordUpdatedDateTime: new Date() } }
    : { $set: { keyLabel: label, recordUpdatedDateTime: new Date() } };
  const result = await collection(db).updateOne({ merchantAgreementInstanceReference, keyId }, update);
  return result.matchedCount > 0;
}

/**
 * Records that a key was just used.
 *
 * Deliberately not awaited by its caller on the request path: a failed bookkeeping write must never
 * turn a successful authentication into an error.
 */
export async function touchKeyUsage(db: Db, keyId: string): Promise<void> {
  await collection(db).updateOne({ keyId }, { $set: { keyLastUsedDateTime: new Date() } });
}
