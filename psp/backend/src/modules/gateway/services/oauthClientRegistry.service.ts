import { Db } from 'mongodb';
import {
  OAUTH_CLIENT_COLLECTION, OAuthClientRecord,
} from '../models/oauthClient.model';

/**
 * The one way anything reads or writes an OAuth client.
 *
 * Every consumer used to reach into the merchant agreement with its own
 * `{ 'merchantOAuthClient.oauthClientId': ... }` query, five of them in four modules, each repeating
 * the same knowledge of where a credential lives. One function instead, so moving the registry again
 * (which is exactly what the next phases do) is a change here and nowhere else.
 */

function collection(db: Db) {
  return db.collection<OAuthClientRecord>(OAUTH_CLIENT_COLLECTION);
}

export async function findClientById(db: Db, clientId: string): Promise<OAuthClientRecord | null> {
  return collection(db).findOne({ oauthClientId: clientId }, { projection: { _id: 0 } });
}

/** The active client for an owner. A revoked one is history, not a credential. */
export async function findActiveClientByOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<OAuthClientRecord | null> {
  return collection(db).findOne(
    { merchantAgreementInstanceReference, oauthClientStatus: { $ne: 'revoked' } },
    { projection: { _id: 0 } },
  );
}

export async function findClientByOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<OAuthClientRecord | null> {
  return collection(db).findOne({ merchantAgreementInstanceReference }, { projection: { _id: 0 } });
}

export async function findClientsByIds(db: Db, clientIds: string[]): Promise<OAuthClientRecord[]> {
  if (clientIds.length === 0) return [];
  return collection(db).find({ oauthClientId: { $in: clientIds } }, { projection: { _id: 0 } }).toArray();
}

export async function insertClient(db: Db, record: OAuthClientRecord): Promise<void> {
  await collection(db).insertOne(record);
}

export async function updateClient(
  db: Db,
  clientId: string,
  patch: Partial<OAuthClientRecord>,
): Promise<void> {
  await collection(db).updateOne(
    { oauthClientId: clientId },
    { $set: { ...patch, recordUpdatedDateTime: new Date() } },
  );
}

/**
 * Revokes the owner's client, if it has one that is not already revoked.
 *
 * Returns whether anything changed, because the caller answers 404 when nothing did and a silent
 * no-op would report success for a revocation that never happened.
 */
export async function revokeClientByOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
): Promise<boolean> {
  const result = await collection(db).updateOne(
    { merchantAgreementInstanceReference, oauthClientStatus: { $ne: 'revoked' } },
    { $set: { oauthClientStatus: 'revoked', recordUpdatedDateTime: new Date() } },
  );
  return result.modifiedCount > 0;
}

/** Keeps the denormalized owner name current, so the audit trail never has to look one up. */
export async function renameClientOwner(
  db: Db,
  merchantAgreementInstanceReference: string,
  merchantName: string,
): Promise<void> {
  await collection(db).updateMany(
    { merchantAgreementInstanceReference },
    { $set: { merchantName, recordUpdatedDateTime: new Date() } },
  );
}
