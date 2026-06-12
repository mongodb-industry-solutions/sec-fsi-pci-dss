import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedCases(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/fraudCases.json'), 'utf-8')
  );

  for (const record of records) {
    await db.collection('fraudDiagnosisCase').updateOne(
      { fraudDiagnosisInstanceReference: record.fraudDiagnosisInstanceReference },
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
