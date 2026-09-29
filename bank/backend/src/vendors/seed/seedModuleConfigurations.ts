import { Db } from 'mongodb';
import {
  BANK_MODULE_CONFIGURATION_COLLECTION, BankModuleConfigurationControlRecord,
} from '../../modules/admin/models/bankModuleConfiguration.model';
import { readSeedFile } from './readSeedFile';
import { config } from '../../config';

// Seeds the configuration of the bank's engines, so a fresh database has a working rule set and the admin
// API has something to edit rather than an empty collection.
//
// The stored document is NOT overwritten on a re-seed. An operator's edit is the whole point of this
// record, and a seed that reset it would quietly undo the last change every time someone reseeds; only
// the descriptive fields are refreshed. `setup:db:reset` is how you go back to the shipped defaults.
export async function seedModuleConfigurations(db: Db): Promise<number> {
  const records = readSeedFile<BankModuleConfigurationControlRecord[]>('moduleConfigurations.json');
  const collection = db.collection<BankModuleConfigurationControlRecord>(BANK_MODULE_CONFIGURATION_COLLECTION);

  for (const record of records) {
    const seeded = { ...record };
    // The consent mode is the one setting that also has an environment variable, since it existed there
    // first. The environment is read at SEED time to write the record; at runtime only the record is read.
    if (seeded.bankModuleCapability === 'consent') {
      seeded.bankModuleConfiguration = {
        ...seeded.bankModuleConfiguration,
        consentMode: config.bank.consentMode,
      };
    }
    await collection.updateOne(
      { bankModuleConfigurationInstanceReference: seeded.bankModuleConfigurationInstanceReference },
      {
        $set: {
          bankModuleCapability: seeded.bankModuleCapability,
          bankModuleDescription: seeded.bankModuleDescription,
          bankModuleConfigurationStatus: seeded.bankModuleConfigurationStatus,
          bankModuleConfigurationConsumed: seeded.bankModuleConfigurationConsumed,
          bianServiceDomain: seeded.bianServiceDomain,
          bianControlRecordType: seeded.bianControlRecordType,
          recordUpdatedDateTime: new Date().toISOString(),
          schemaVersion: seeded.schemaVersion,
        },
        // Only on insert: an operator's edit survives a re-seed.
        $setOnInsert: {
          bankModuleConfiguration: seeded.bankModuleConfiguration,
          recordCreatedDateTime: seeded.recordCreatedDateTime,
        },
      },
      { upsert: true },
    );
  }
  console.log(`  ${BANK_MODULE_CONFIGURATION_COLLECTION}: ${records.length} engine configuration(s) upserted`);
  return records.length;
}
