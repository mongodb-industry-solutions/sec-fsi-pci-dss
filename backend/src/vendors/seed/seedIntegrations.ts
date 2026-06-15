import { Db } from 'mongodb';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
  EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION,
  ExternalProviderArrangement,
} from '../../modules/providers/models/externalProviderArrangement.model';
import { seedRoutingGroups } from './seedRoutingGroups';

const DATA_DIR: string = process.env.SEED_DATA_DIR ?? join(process.cwd(), 'data');

export async function seedIntegrations(db: Db): Promise<void> {
  const raw = readFileSync(join(DATA_DIR, 'externalProviderArrangement.json'), 'utf8');
  const records: ExternalProviderArrangement[] = JSON.parse(raw);

  // integrationEvents is a timeseries collection created by createCollections.ts (ADR-025).
  // No explicit creation needed here.

  for (const record of records) {
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
      },
      { upsert: true }
    );
  }

  // Seed default routing groups (one per IntegrationProviderType) and bind internal providers
  await seedRoutingGroups(db);
}
