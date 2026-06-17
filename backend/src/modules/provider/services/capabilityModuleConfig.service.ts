// Shared CRUD for capabilityModuleConfiguration (ADR-029). Each internal Module reads its config
// here (thresholds/rules + the callback route it must call) and the admin /config endpoints write
// it. The DB logic lives once; each capability module still declares its OWN static routes.
import { Db } from 'mongodb';
import {
  CAPABILITY_MODULE_CONFIGURATION_COLLECTION,
  CapabilityModuleConfiguration,
} from '../models/capabilityModuleConfiguration.model';

export async function getCapabilityModuleConfig(
  db: Db,
  capability: string,
): Promise<CapabilityModuleConfiguration | null> {
  return db
    .collection<CapabilityModuleConfiguration>(CAPABILITY_MODULE_CONFIGURATION_COLLECTION)
    .findOne({ capability });
}

export async function upsertCapabilityModuleConfig(
  db: Db,
  capability: string,
  patch: Partial<CapabilityModuleConfiguration>,
): Promise<CapabilityModuleConfiguration | null> {
  const now = new Date();
  await db
    .collection<CapabilityModuleConfiguration>(CAPABILITY_MODULE_CONFIGURATION_COLLECTION)
    .updateOne(
      { capability },
      {
        $set: { ...patch, capability, recordUpdatedDateTime: now },
        $setOnInsert: {
          capabilityModuleInstanceReference: capability,
          recordCreatedDateTime: now,
        },
      },
      { upsert: true },
    );
  return getCapabilityModuleConfig(db, capability);
}
