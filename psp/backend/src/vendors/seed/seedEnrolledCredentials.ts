import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PARTY_ENROLLED_CREDENTIAL_COLLECTION } from '../../modules/identity/models/partyEnrolledCredential.model';

// seed the demo user's passwordless credential (public key only). The matching private key is a
// test/demo fixture (test/fixtures/demoAuthenticatorKey.ts), never stored server-side.
export async function seedEnrolledCredentials(db: Db) {
  const filePath = path.join(__dirname, '../../../data/enrolledCredentials.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection(PARTY_ENROLLED_CREDENTIAL_COLLECTION).updateOne(
      { partyEnrolledCredentialInstanceReference: record.partyEnrolledCredentialInstanceReference },
      { $set: { ...record, createdAt: new Date(record.createdAt) } },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${PARTY_ENROLLED_CREDENTIAL_COLLECTION}: ${upserted} upserted`);
}
