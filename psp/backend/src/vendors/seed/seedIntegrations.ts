import { Db } from 'mongodb';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
  EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION,
  ExternalProviderArrangement,
} from '../../modules/provider/models/externalProviderArrangement.model';
import { deriveEventConfigs } from '../../modules/provider/services/providerEventConfig.service';
import { seedRoutingGroups } from './seedRoutingGroups';
import { resolveBankcoreLink } from './resolveProviderCredential';

const DATA_DIR: string = process.env.PSP_SEED_DATA_DIR ?? join(process.cwd(), 'data');

export async function seedIntegrations(db: Db): Promise<void> {
  const raw = readFileSync(join(DATA_DIR, 'externalProviderArrangement.json'), 'utf8');
  const records: ExternalProviderArrangement[] = JSON.parse(raw);

  // integrationEvents is a timeseries collection created by createCollections.ts (ADR-025).
  // No explicit creation needed here.

  for (const record of records) {
    // The TPP credential and the bank's token endpoint: the environment is read at SEED time to write
    // the record, and at runtime only the record is read.
    resolveBankcoreLink(record);
    // §2.4: store per-event config on every vendor. Derive it from the trigger-event list + the
    // (template) vendor-global config so the stored doc is per-event (the resolver's source of truth).
    record.externalProviderEvents = deriveEventConfigs(record);

    // A field the seed no longer declares is REMOVED, not left behind.
    //
    // `$set` only writes what it is given, so dropping a field from the fixture used to leave the old value
    // alive in the database. That went unnoticed until it mattered: v37 P12 removed the loopback
    // `externalProviderApiEndpoint` from the bank capabilities, the fixture no longer had it, and every
    // seeded record kept pointing at a route that had been deleted. Since the resolver falls back to that
    // field for any event without its own path, the removal achieved nothing until this unset existed.
    //
    // Only these two are swept, deliberately. A blanket "unset everything absent" would also erase the fields
    // written at RUNTIME rather than by the seed, such as the health status a probe records.
    const removable = ['externalProviderApiEndpoint', 'externalProviderInternalHandler'] as const;
    const unset = Object.fromEntries(
      removable.filter((field) => record[field] === undefined)
        .map((field) => [field, '']),
    );

    await db.collection(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).updateOne(
      { externalProviderArrangementInstanceReference: record.externalProviderArrangementInstanceReference },
      {
        $set: {
          ...record,
          recordCreatedDateTime: new Date(record.recordCreatedDateTime as unknown as string),
          recordUpdatedDateTime: new Date(record.recordUpdatedDateTime as unknown as string),
          externalProviderLastHealthCheckAt: record.externalProviderLastHealthCheckAt
            ? new Date(record.externalProviderLastHealthCheckAt as unknown as string)
            : undefined,
        },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { upsert: true }
    );
  }

  // Seed default routing groups (one per IntegrationProviderType) and bind internal providers
  await seedRoutingGroups(db);
}
