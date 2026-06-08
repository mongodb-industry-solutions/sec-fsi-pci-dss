import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PARTY_COLLECTION } from '../../modules/identity/models/party.model';

export async function seedParties(db: Db) {
  const filePath = path.join(__dirname, '../../../data/parties.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection(PARTY_COLLECTION).updateOne(
      { partyInstanceReference: record.partyInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${PARTY_COLLECTION}: ${upserted} upserted`);
}
