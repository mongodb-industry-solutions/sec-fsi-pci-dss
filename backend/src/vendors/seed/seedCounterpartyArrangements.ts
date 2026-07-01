import { Db } from 'mongodb';
import { COUNTERPARTY_COLLECTION } from '../../modules/identity/models/counterpartyArrangement.model';

// No demo beneficiary entries at seed time — users register beneficiaries at runtime.
export async function seedCounterpartyArrangements(db: Db) {
  void db;
  console.log(`  ${COUNTERPARTY_COLLECTION}: skipped (registered at runtime via beneficiary API)`);
}
