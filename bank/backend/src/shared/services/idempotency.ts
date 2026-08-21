import { Db } from 'mongodb';
import { IDEMPOTENCY_COLLECTION } from '../../vendors/setup/createCollections';

// Idempotency for the operations where a retry must not repeat the effect, which in this bank means
// initiating a payment. The key is the caller's `X-Request-ID`, which Berlin Group already requires to be
// unique per call, so nothing proprietary is introduced.
//
// The unique index on the key IS the mutex: the insert is what claims the key, so two concurrent retries
// cannot both proceed. Checking first and then writing would leave exactly the window this closes.

export interface StoredOutcome {
  status: number;
  body: unknown;
}

interface IdempotencyRecord {
  idempotencyKeyValue: string;
  idempotencyState: 'in_progress' | 'completed';
  idempotencyOutcome?: StoredOutcome;
  recordCreatedDateTime: Date;
}

export type IdempotentResult =
  | { kind: 'fresh'; outcome: StoredOutcome }
  | { kind: 'replayed'; outcome: StoredOutcome }
  // A retry that arrives while the first attempt is still running. Answering it with the standard
  // conflict is honest; inventing an outcome or waiting for the other attempt is not.
  | { kind: 'in_progress' };

/**
 * Runs an operation at most once per key. A replay returns the first outcome verbatim, so a retried
 * payment initiation returns the SAME paymentId instead of creating a second payment.
 */
export async function runIdempotent(
  db: Db,
  key: string,
  operation: () => Promise<StoredOutcome>,
): Promise<IdempotentResult> {
  const collection = db.collection<IdempotencyRecord>(IDEMPOTENCY_COLLECTION);
  try {
    await collection.insertOne({
      idempotencyKeyValue: key,
      idempotencyState: 'in_progress',
      recordCreatedDateTime: new Date(),
    });
  } catch (err) {
    // 11000: someone already claimed this key. Whether it finished decides what the caller gets.
    if ((err as { code?: number }).code !== 11000) throw err;
    const existing = await collection.findOne({ idempotencyKeyValue: key });
    if (existing?.idempotencyState === 'completed' && existing.idempotencyOutcome) {
      return { kind: 'replayed', outcome: existing.idempotencyOutcome };
    }
    return { kind: 'in_progress' };
  }

  try {
    const outcome = await operation();
    await collection.updateOne(
      { idempotencyKeyValue: key },
      { $set: { idempotencyState: 'completed', idempotencyOutcome: outcome } },
    );
    return { kind: 'fresh', outcome };
  } catch (err) {
    // A failed attempt must not poison the key: the caller has to be able to retry a transient failure.
    await collection.deleteOne({ idempotencyKeyValue: key });
    throw err;
  }
}
