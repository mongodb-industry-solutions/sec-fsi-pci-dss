import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CUSTOMER_AUTHENTICATION_COLLECTION } from '../../modules/identity/models/customerAuthentication.model';

export async function seedUsers(db: Db) {
  const filePath = path.join(__dirname, '../../../data/customerAuthentications.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection(CUSTOMER_AUTHENTICATION_COLLECTION).updateOne(
      { customerAuthenticationInstanceReference: record.customerAuthenticationInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${CUSTOMER_AUTHENTICATION_COLLECTION}: ${upserted} upserted`);
}
