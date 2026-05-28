import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedCards(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/paymentCards.json'), 'utf-8')
  );

  for (const record of records) {
    await db.collection('paymentCard').updateOne(
      { paymentCardInstanceReference: record.paymentCardInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  paymentCard: ${records.length} upserted`);
}
