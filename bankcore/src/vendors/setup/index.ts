import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { createCollections } from './createCollections';
import { provisionBankDeks, findOrphanedDeks } from '../encryption/keyVault';
import { createIndexes } from './createIndexes';
import { getQEClient, closeQEClient, assertCryptSharedLib } from '../encryption/qeClient';
import { config } from '../../config';

// Works regardless of CWD: npm --prefix changes it to bankcore/.
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

export async function runSetup(reset = false): Promise<void> {
  if (!config.mongodb.uri) {
    throw new Error(
      'PSP_BANKCORE_DB_URI / MONGODB_URI is not set.\n'
      + '  bankcore defaults to the PSP cluster with its own database (PSP_BANKCORE_DB_NAME).',
    );
  }

  // Validate before connecting: a wrong crypt_shared path fails the connection itself and reads as
  // a plain connectivity error.
  console.log(`crypt_shared: ${assertCryptSharedLib()}`);
  console.log(`key vault:    ${config.kms.keyVaultNamespace} (shared with the PSP)\n`);

  const client = await getQEClient();
  try {
    const db = client.db(config.mongodb.dbName);
    console.log(`Connected to the bank database "${config.mongodb.dbName}"\n`);

    // A bank database that survived a PSP reset points at DEKs the shared vault no longer has. Fail
    // here with the remedy, instead of at the first encrypted read with a driver-level message.
    if (!reset) {
      const orphans = await findOrphanedDeks(client, config.mongodb.dbName);
      if (orphans.length > 0) {
        throw new Error(
          `These bank collections reference DEKs that no longer exist in ${config.kms.keyVaultNamespace}: `
          + `${orphans.join(', ')}.\n`
          + '  The shared key vault was dropped without dropping the bank database.\n'
          + '  Rebuild it with:  npm run setup:db:reset --prefix bankcore   (or npm run setup:reset from the repo root)',
        );
      }
    }

    console.log('1. Provisioning DEKs in the shared key vault...');
    const deks = await provisionBankDeks(client);
    console.log('');

    console.log('2. Creating collections...');
    await createCollections(db, deks, reset);
    console.log('');

    console.log('3. Creating indexes...');
    await createIndexes(db);
    console.log('');

    console.log('bankcore setup complete.');
    console.log('  Seed it with: npm run setup:seed --prefix bankcore');
  } finally {
    await closeQEClient();
  }
}
