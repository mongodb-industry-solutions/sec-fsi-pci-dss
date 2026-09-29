import { Db } from 'mongodb';
import {
  COUNTERPARTY_BANK_COLLECTION, CounterpartyBankControlRecord,
} from '../../modules/payment-hub/models/counterpartyBank.model';
import { readSeedFile } from './readSeedFile';

// The institutions this bank can reach, and one it deliberately cannot.
//
// The unreachable entry matters: without it the refusal path is unreachable in a demo, and a path nobody can
// show is a path nobody trusts. It is what makes "this beneficiary cannot be paid, and here is why"
// demonstrable rather than theoretical.
export async function seedCounterpartyBanks(db: Db): Promise<number> {
  const records = readSeedFile<CounterpartyBankControlRecord[]>('counterpartyBanks.json');
  for (const record of records) {
    await db.collection<CounterpartyBankControlRecord>(COUNTERPARTY_BANK_COLLECTION).updateOne(
      { counterpartyBankInstanceReference: record.counterpartyBankInstanceReference },
      { $set: { ...record, recordUpdatedDateTime: new Date().toISOString() } },
      { upsert: true },
    );
  }
  const reachable = records.filter((record) => record.counterpartyBankStatus === 'reachable').length;
  console.log(`  ${COUNTERPARTY_BANK_COLLECTION}: ${records.length} institution(s), ${reachable} reachable`);
  return records.length;
}
