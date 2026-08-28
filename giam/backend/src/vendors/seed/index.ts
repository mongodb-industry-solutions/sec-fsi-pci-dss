import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { config } from '../../config';

dotenv.config({ path: resolve(__dirname, '../../../../../.env') });

// Seeders are idempotent and additive: an existing document is upserted, never clobbered, so a reseed
// over a populated database does not destroy state a demonstration depends on. Identifiers are
// deterministic, which is what lets another service reference one without ever reading this database.
export async function runSeed(): Promise<void> {
  if (!config.mongodb.uri) throw new Error('GIAM_DB_URI / MONGODB_URI is not set');
  const client = await getQEClient();
  try {
    const db = client.db(config.mongodb.dbName);
    console.log(`Seeding the GIAM database "${config.mongodb.dbName}"\n`);
    void db;
    // Seeders arrive with the phases that own their records.
    console.log('\nGIAM seed complete.');
  } finally {
    await closeQEClient();
  }
}
