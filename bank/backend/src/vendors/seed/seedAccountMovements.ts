import { Db } from 'mongodb';
import { ACCOUNT_MOVEMENT_COLLECTION, AccountMovementRecord } from '../../modules/aspsp/models/accountMovement.model';
import { readSeedFile } from './readSeedFile';

// The ledger's own history: what an account's balance is actually made of.
//
// Every account here was seeded with a final balance and no movements behind it, which answered "how much"
// and never "why". A statement, a card's transaction list and the audit trail all read this collection, and
// none of them could show anything before it existed.
//
// Idempotent on the deterministic reference, same as every other fixture: a reseed upserts the same rows
// rather than appending a second copy. Fixture amounts are hand-reconciled against the account's own stated
// balance (see accountMovement.json's ordering per account); nothing here computes or corrects a balance, it
// only records what the fixture already agreed on.
export async function seedAccountMovements(db: Db): Promise<number> {
  const movements = readSeedFile<AccountMovementRecord[]>('accountMovement.json');
  const collection = db.collection<AccountMovementRecord>(ACCOUNT_MOVEMENT_COLLECTION);
  for (const movement of movements) {
    // No `recordUpdatedDateTime`, unlike every other fixture here: a ledger entry is not edited once
    // recorded, so there is nothing for that field to mean.
    await collection.updateOne(
      { accountMovementInstanceReference: movement.accountMovementInstanceReference },
      { $set: movement },
      { upsert: true },
    );
  }
  console.log(`  ${ACCOUNT_MOVEMENT_COLLECTION}: ${movements.length} movement(s) upserted`);
  return movements.length;
}
