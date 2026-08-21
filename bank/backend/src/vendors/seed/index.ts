import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { seedBankProfile } from './seedBankProfile';
import { seedAccountHolders, seedAccountArrangements } from './seedAccounts';
import { seedTppRegistrations } from './seedTppRegistrations';
import { seedConsents } from './seedConsents';
import { seedModuleConfigurations } from './seedModuleConfigurations';
import { seedEventSubscriptions } from './seedEventSubscriptions';
import { seedCounterpartyBanks } from './seedCounterpartyBanks';
import { seedCardIssuer } from './seedCardIssuer';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { config } from '../../config';

dotenv.config({ path: resolve(__dirname, '../../../../../.env') });

// The bank is seeded BEFORE the PSP: the PSP's records point at the bank's, not the other way round.
export async function runSeed(): Promise<void> {
  if (!config.mongodb.uri) throw new Error('PSP_BANKCORE_DB_URI / MONGODB_URI is not set');
  const client = await getQEClient();
  try {
    const db = client.db(config.mongodb.dbName);
    console.log(`Seeding the bank database "${config.mongodb.dbName}"\n`);
    await seedBankProfile(db);
    // Holders before accounts: an account references its holder.
    await seedAccountHolders(db);
    await seedAccountArrangements(db);
    // The registered TPP, so the PSP can obtain a token the moment both services are up.
    await seedTppRegistrations(db);
    // Consents last: they reference the accounts and the TPP that were just written.
    await seedConsents(db);
    // Engine configuration, so the admin API has something to edit on a fresh database.
    await seedModuleConfigurations(db);
    // Where to deliver notifications. After the TPP, since it belongs to one.
    await seedEventSubscriptions(db);
    // Who this bank can reach, which is what makes an external payment routable.
    await seedCounterpartyBanks(db);
    // The cards this bank issues. After the profile, since the BIN comes from its own declared ranges.
    await seedCardIssuer(db);
    console.log('\nbankcore seed complete.');
  } finally {
    await closeQEClient();
  }
}
