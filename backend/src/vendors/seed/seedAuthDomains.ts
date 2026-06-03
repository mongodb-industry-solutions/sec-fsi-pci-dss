import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedAuthDomains(db: Db) {
  const filePath = path.join(__dirname, '../../../data/authDomains.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection('authenticationDomain').updateOne(
      { partyAuthenticationDomainInstanceReference: record.partyAuthenticationDomainInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  authDomains: ${upserted} upserted`);
}
