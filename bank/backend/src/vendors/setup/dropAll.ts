import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { config } from '../../config';

dotenv.config({ path: resolve(__dirname, '../../../../../.env') });

// Drops the bank database only. The shared key vault is the PSP's and is never touched here:
// dropping it would take the PSP's DEKs with it.
export async function dropAll(): Promise<void> {
  if (!config.mongodb.uri) throw new Error('PSP_BANKCORE_DB_URI / MONGODB_URI is not set');
  const client = await getQEClient();
  try {
    await client.db(config.mongodb.dbName).dropDatabase();
    console.log(`  dropped database: ${config.mongodb.dbName}`);
    console.log(`  kept key vault:   ${config.kms.keyVaultNamespace} (owned by the PSP)`);
  } finally {
    await closeQEClient();
  }
}
