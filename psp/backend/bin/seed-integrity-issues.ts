import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { seedIntegrityIssues } from '../src/vendors/seed/seedIntegrityIssues';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new MongoClient(uri);

console.log('Seeding integrity issues (deliberate duplicates for audit demo)...');
seedIntegrityIssues(client)
  .then(result => {
    console.log(`Done: ${result.duplicatesInserted} duplicate(s) inserted across ${result.refsAffected} case reference(s).`);
    if (result.skippedRefs.length) {
      console.log(`Skipped references (not in DB): ${result.skippedRefs.join(', ')}`);
    }
    console.log('\nRun "npm run setup:db" to trigger self-healing deduplication.');
    return client.close();
  })
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    client.close().catch(() => {});
    process.exit(1);
  });
