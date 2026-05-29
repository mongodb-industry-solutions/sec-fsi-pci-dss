import { MongoClient, Binary } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { provisionDEKs } from './provisionDEKs';
import { createCollections } from './createCollections';
import { createIndexes } from './createIndexes';

// Load .env from project root — works regardless of CWD (npm --prefix changes CWD to backend/)
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

export async function runSetup(reset = false) {
  const client = new MongoClient(process.env.MONGODB_URI!);
  try {
    await client.connect();
    console.log('Connected to Atlas');

    console.log('\n1. Provisioning DEKs...');
    const { dekLookupId, dekSensitiveId } = await provisionDEKs(client);
    console.log('   DEK-lookup and DEK-sensitive provisioned');

    console.log('\n2. Creating collections...');
    await createCollections(client, dekLookupId as Binary, dekSensitiveId as Binary, reset);

    console.log('\n3. Creating indexes...');
    await createIndexes(client);
    console.log('   Indexes created');

    console.log('\nSetup complete.');
  } finally {
    await client.close();
  }
}
