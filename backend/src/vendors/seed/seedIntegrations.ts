import { Db } from 'mongodb';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  INTEGRATION_REGISTRY_COLLECTION,
  INTEGRATION_EVENTS_COLLECTION,
  ExternalProviderArrangement,
} from '../../modules/integrations/models/externalProviderArrangement.model';

const DATA_DIR: string = process.env.SEED_DATA_DIR ?? join(process.cwd(), 'data');

export async function seedIntegrations(db: Db): Promise<void> {
  const raw = readFileSync(join(DATA_DIR, 'integrationRegistry.json'), 'utf8');
  const records: ExternalProviderArrangement[] = JSON.parse(raw);

  // Ensure integrationEvents collection exists (no seed data needed)
  const collections = await db.listCollections({ name: INTEGRATION_EVENTS_COLLECTION }).toArray();
  if (collections.length === 0) {
    await db.createCollection(INTEGRATION_EVENTS_COLLECTION);
  }

  for (const record of records) {
    await db.collection(INTEGRATION_REGISTRY_COLLECTION).updateOne(
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
}
