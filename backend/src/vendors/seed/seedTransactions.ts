import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CARD_TRANSACTION_COLLECTION } from '../../modules/transaction/models/cardTransaction.model';

// v2: cardTransactions.json contains merged sensitive fields (rawGatewayPayload,
// processorTransactionMetadata). The QE client encrypts them with DEK-sensitive tier
// on write - no separate *Sensitive file.
export async function seedTransactions(db: Db) {
  const txns = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/cardTransactions.json'), 'utf-8')
  );

  for (const record of txns) {
    await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
      { cardTransactionInstanceReference: record.cardTransactionInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  ${CARD_TRANSACTION_COLLECTION}: ${txns.length} upserted`);
}
