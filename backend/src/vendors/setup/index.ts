import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { provisionDEKs } from './provisionDEKs';
import { createCollections } from './createCollections';
import { createIndexes } from './createIndexes';

// Load .env from project root — works regardless of CWD (npm --prefix changes CWD to backend/)
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

export async function runSetup(reset = false) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set.\n' +
      '  1. Copy .env.example to .env\n' +
      '  2. Fill in MONGODB_URI (Atlas connection string)\n' +
      '  3. Set KMS_PROVIDER=local and run: npm run setup:key\n' +
      '  4. Re-run: npm run setup:db'
    );
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to Atlas\n');

    console.log('1. Provisioning DEKs (one per encrypted field)...');
    const deks = await provisionDEKs(client);
    console.log('   DEKs provisioned\n');

    console.log('2. Creating collections...');
    await createCollections(client, deks, reset);
    console.log('');

    console.log('3. Creating indexes...');
    await createIndexes(client);
    console.log('   Indexes created\n');

    console.log('Setup complete. Run: npm run setup:seed');
  } finally {
    await client.close();
  }
}
