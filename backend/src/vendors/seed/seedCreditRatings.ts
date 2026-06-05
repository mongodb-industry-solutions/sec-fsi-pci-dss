import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedCreditRatings(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerCreditRatings.json'), 'utf-8')
  );

  for (const record of records) {
    await db.collection('customerCreditRating').updateOne(
      { customerCreditRatingInstanceReference: record.customerCreditRatingInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  customerCreditRating: ${records.length} upserted`);
}
