import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CUSTOMER_AUTHENTICATION_COLLECTION } from '../../modules/identity/models/customerAuthentication.model';
import { PARTY_COLLECTION } from '../../modules/identity/models/party.model';
import { deriveCustomerLogins, type AuthenticationSeed, type PartySeed } from './dataIntegrity';

export async function seedUsers(db: Db) {
  const filePath = path.join(__dirname, '../../../data/customerAuthentications.json');
  const records: AuthenticationSeed[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

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

  // v33 (F1): every customer party must be able to sign in. The fixtures already carry a login per
  // customer (the generator applies the same derivation), so this is an idempotent safety net that
  // also closes the gap for a party added to parties.json without one. Identity comes from the party,
  // being the source of truth, so a login can never disagree with the KYC record.
  const parties = (await db
    .collection(PARTY_COLLECTION)
    .find({ partyType: 'customer' }, { projection: { _id: 0, partyInstanceReference: 1, partyType: 1, partyName: 1, partyEmailAddress: 1, recordCreatedDateTime: 1 } })
    .toArray()) as unknown as PartySeed[];
  const logins = (await db
    .collection(CUSTOMER_AUTHENTICATION_COLLECTION)
    .find({}, { projection: { _id: 0, customerAuthenticationInstanceReference: 1, partyInstanceReference: 1, customerAuthenticationEmailAddress: 1, customerAuthenticationCredentialHash: 1, customerAuthenticationUserRole: 1 } })
    .toArray()) as unknown as AuthenticationSeed[];

  const derived = deriveCustomerLogins(parties, logins);
  for (const record of derived) {
    await db.collection(CUSTOMER_AUTHENTICATION_COLLECTION).updateOne(
      { customerAuthenticationInstanceReference: record.customerAuthenticationInstanceReference },
      { $setOnInsert: record },
      { upsert: true }
    );
  }

  // Coverage is logged unconditionally so a future gap is visible at seed time rather than at demo
  // time. Counted from the records already read (QE collections do not support `distinct`).
  const covered = new Set([...logins, ...derived].map((l) => l.partyInstanceReference));
  const withLogin = parties.filter((p) => covered.has(p.partyInstanceReference)).length;
  console.log(
    `  ${CUSTOMER_AUTHENTICATION_COLLECTION}: customer parties with a login: ${withLogin}/${parties.length}` +
    (derived.length > 0 ? ` (+${derived.length} derived)` : ''),
  );
}
