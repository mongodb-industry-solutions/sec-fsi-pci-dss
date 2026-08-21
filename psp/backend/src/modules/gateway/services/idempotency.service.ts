// v17.1: lightweight idempotency store for money-moving POSTs (PSP operational baseline).
// Keyed by (scope, party, key). Stores the prior response so a replay (same Idempotency-Key)
// returns the original outcome instead of executing twice. Best-effort; a unique index on the
// composite key makes the first writer win under a race.

import { Db } from 'mongodb';

export const IDEMPOTENCY_COLLECTION = 'idempotencyKey';

interface IdempotencyRecord {
  idempotencyKey: string;        // composite: scope|party|key
  scope: string;
  partyReference: string;
  response: unknown;
  recordCreatedDateTime: Date;
}

function composite(scope: string, partyRef: string, key: string): string {
  return `${scope}|${partyRef}|${key}`;
}

/** Return a stored response for this key, or undefined if unseen. */
export async function getIdempotent<T>(db: Db, scope: string, partyRef: string, key: string): Promise<T | undefined> {
  const doc = await db.collection<IdempotencyRecord>(IDEMPOTENCY_COLLECTION)
    .findOne({ idempotencyKey: composite(scope, partyRef, key) });
  return doc ? (doc.response as T) : undefined;
}

/** Persist the response for this key. First writer wins (duplicate key is ignored). */
export async function saveIdempotent(db: Db, scope: string, partyRef: string, key: string, response: unknown): Promise<void> {
  try {
    await db.collection<IdempotencyRecord>(IDEMPOTENCY_COLLECTION).insertOne({
      idempotencyKey: composite(scope, partyRef, key),
      scope,
      partyReference: partyRef,
      response,
      recordCreatedDateTime: new Date(),
    });
  } catch { /* duplicate key: another request already stored the canonical response */ }
}
