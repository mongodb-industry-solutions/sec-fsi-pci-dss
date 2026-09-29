import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

const CUSTOMER_CREDIT_RATING_COLLECTION = 'customerCreditRatingState';

export async function seedCreditRatings(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerCreditRatings.json'), 'utf-8')
  );

  for (const record of records) {
    await db.collection(CUSTOMER_CREDIT_RATING_COLLECTION).updateOne(
      { customerCreditRatingInstanceReference: record.customerCreditRatingInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  ${CUSTOMER_CREDIT_RATING_COLLECTION}: ${records.length} upserted`);
}
