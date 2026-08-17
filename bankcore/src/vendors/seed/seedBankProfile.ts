import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../modules/aspsp/models/bankProfile.model';
import { readSeedFile } from './readSeedFile';

// Idempotent upsert on the deterministic reference, so re-seeding updates in place and never creates
// a second bank. Adding another bank later is another record in this file, not a code change.
export async function seedBankProfile(db: Db): Promise<number> {
  const profiles = readSeedFile<BankProfileControlRecord[]>('bankProfile.json');
  for (const profile of profiles) {
    await db.collection<BankProfileControlRecord>(BANK_PROFILE_COLLECTION).updateOne(
      { bankProfileInstanceReference: profile.bankProfileInstanceReference },
      { $set: { ...profile, recordUpdatedDateTime: new Date().toISOString() } },
      { upsert: true },
    );
  }
  console.log(`  ${BANK_PROFILE_COLLECTION}: ${profiles.length} bank profile(s) upserted`);
  return profiles.length;
}
