import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedTransactions(db: Db) {
  const txns = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/cardTransactions.json'), 'utf-8')
  );
  const sensitive = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/cardTransactionsSensitive.json'), 'utf-8')
  );

  for (const record of txns) {
    await db.collection('cardTransaction').updateOne(
      { cardTransactionInstanceReference: record.cardTransactionInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  cardTransaction: ${txns.length} upserted`);

  for (const record of sensitive) {
    await db.collection('cardTransactionSensitive').updateOne(
      { cardTransactionInstanceReference: record.cardTransactionInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  cardTransactionSensitive: ${sensitive.length} upserted`);
}
