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

/**
 * Claims a key for the caller, atomically. Returns true for the FIRST caller and false for every
 * subsequent one, so an operation that must happen at most once can guard itself without inventing a lock.
 *
 * v37: this exists because the commission settlement was using the balance credit log as its guard, taking
 * `upsertedCount !== 1` on an audit row to mean "already collected". That worked, and it tied a fee
 * collection to an audit collection that belongs to the bank: moving the log would have silently removed the
 * guard and collected the fee twice. Idempotency belongs in the idempotency store.
 */
export async function claimIdempotent(db: Db, scope: string, partyRef: string, key: string): Promise<boolean> {
  const result = await db.collection<IdempotencyRecord>(IDEMPOTENCY_COLLECTION).updateOne(
    { idempotencyKey: composite(scope, partyRef, key) },
    {
      $setOnInsert: {
        idempotencyKey: composite(scope, partyRef, key),
        scope,
        partyReference: partyRef,
        response: { claimed: true },
        recordCreatedDateTime: new Date(),
      },
    },
    { upsert: true },
  );
  // The unique index on the composite key makes this the first writer under a race.
  return result.upsertedCount === 1;
}
