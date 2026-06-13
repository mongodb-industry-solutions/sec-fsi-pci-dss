import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedCases(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/fraudCases.json'), 'utf-8')
  );

  for (const record of records) {
    // Delete any duplicate runtime cases that share the same business key before
    // upserting the canonical seed record. This ensures the unique index on
    // fraudDiagnosisCaseReference can be created cleanly by createIndexes.ts.
    await db.collection('fraudDiagnosisCase').deleteMany({
      fraudDiagnosisCaseReference: record.fraudDiagnosisCaseReference,
      fraudDiagnosisInstanceReference: { $ne: record.fraudDiagnosisInstanceReference },
    });
    await db.collection('fraudDiagnosisCase').updateOne(
      { fraudDiagnosisCaseReference: record.fraudDiagnosisCaseReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  fraudDiagnosisCase: ${records.length} upserted`);

  // Initialize the case-reference sequence above the seeded references
  // (FD-YYYY-000001..000020) so runtime-created cases start at 001001 and never
  // collide. $setOnInsert: only set on first seed; never resets an advanced counter.
  await db.collection<{ _id: string; seq: number }>('counters').updateOne(
    { _id: 'fraudDiagnosisCaseReference' },
    { $setOnInsert: { seq: 1000 } },
    { upsert: true }
  );
}
