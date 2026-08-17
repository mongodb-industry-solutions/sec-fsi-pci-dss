import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { seedBankProfile } from './seedBankProfile';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { config } from '../../config';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

// The bank is seeded BEFORE the PSP: the PSP's records point at the bank's, not the other way round.
export async function runSeed(): Promise<void> {
  if (!config.mongodb.uri) throw new Error('PSP_BANKCORE_DB_URI / MONGODB_URI is not set');
  const client = await getQEClient();
  try {
    const db = client.db(config.mongodb.dbName);
    console.log(`Seeding the bank database "${config.mongodb.dbName}"\n`);
    await seedBankProfile(db);
    console.log('\nbankcore seed complete.');
  } finally {
    await closeQEClient();
  }
}
