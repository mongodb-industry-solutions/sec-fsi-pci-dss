import { Db } from 'mongodb';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  CAPABILITY_MODULE_CONFIGURATION_COLLECTION,
  CapabilityModuleConfiguration,
} from '../../modules/providers/models/capabilityModuleConfiguration.model';

const DATA_DIR: string = process.env.SEED_DATA_DIR ?? join(process.cwd(), 'data');

// Seeds the internal Module configs (ADR-029, plan §3.5). Together with the internal linking
// vendors in externalProviderArrangement.json (re-pointed to /modules/<cap>/...), this wires the
// full cycle so each capability works out-of-the-box on its internal Module.
export async function seedCapabilityModules(db: Db): Promise<void> {
  const raw = readFileSync(join(DATA_DIR, 'capabilityModuleConfiguration.json'), 'utf8');
  const records: CapabilityModuleConfiguration[] = JSON.parse(raw);

  for (const record of records) {
    await db.collection(CAPABILITY_MODULE_CONFIGURATION_COLLECTION).updateOne(
      { capability: record.capability },
      {
        $set: {
          ...record,
          recordCreatedDateTime: new Date(record.recordCreatedDateTime as unknown as string),
          recordUpdatedDateTime: new Date(record.recordUpdatedDateTime as unknown as string),
        },
      },
      { upsert: true },
    );
  }
  console.log(`  capabilityModuleConfiguration: ${records.length} upserted`);
}
