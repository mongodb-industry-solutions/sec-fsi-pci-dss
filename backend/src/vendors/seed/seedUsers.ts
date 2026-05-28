import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedUsers(db: Db) {
  const filePath = path.join(__dirname, '../../../data/users.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection('partyAuthentication').updateOne(
      { partyAuthenticationInstanceReference: record.partyAuthenticationInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  users: ${upserted} upserted`);
}
