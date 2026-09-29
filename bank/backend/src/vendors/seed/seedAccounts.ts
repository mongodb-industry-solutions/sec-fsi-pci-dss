import { Db } from 'mongodb';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION, AccountHolderControlRecord } from '../../modules/aspsp/models/accountHolder.model';
import { readSeedFile } from './readSeedFile';

// Idempotent upserts on the deterministic references the PSP's linked records point at. Balances are
// seeded here because this side owns them now; the PSP's copy is a projection from P2.4 onward.
export async function seedAccountHolders(db: Db): Promise<number> {
  const holders = readSeedFile<AccountHolderControlRecord[]>('accountHolders.json');
  for (const holder of holders) {
    await db.collection<AccountHolderControlRecord>(ACCOUNT_HOLDER_COLLECTION).updateOne(
      { accountHolderInstanceReference: holder.accountHolderInstanceReference },
      { $set: { ...holder, recordUpdatedDateTime: new Date().toISOString() } },
      { upsert: true },
    );
  }
  console.log(`  ${ACCOUNT_HOLDER_COLLECTION}: ${holders.length} holder(s) upserted (QE on name and contact)`);
  return holders.length;
}

export async function seedAccountArrangements(db: Db): Promise<number> {
  const accounts = readSeedFile<AccountArrangementControlRecord[]>('accountArrangements.json');
  for (const account of accounts) {
    await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION).updateOne(
      { accountArrangementInstanceReference: account.accountArrangementInstanceReference },
      { $set: { ...account, recordUpdatedDateTime: new Date().toISOString() } },
      { upsert: true },
    );
  }
  console.log(`  ${ACCOUNT_ARRANGEMENT_COLLECTION}: ${accounts.length} account(s) upserted with balances (QE on IBAN)`);
  return accounts.length;
}
