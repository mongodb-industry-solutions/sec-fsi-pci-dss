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

  // Initialize / reconcile the case-reference sequence so runtime-created cases never
  // collide with an existing reference. The counter must sit at least at 1000 (above the
  // seeded FD-YYYY-000001..000020 band) AND above the highest numeric suffix actually
  // present, in case the counter document drifted below the data (e.g. created by a
  // runtime $inc starting at 1, or a pre-ADR-024 DB). A $max pipeline update only ever
  // raises the counter, never lowers an already-advanced one.
  const existing = await db
    .collection('fraudDiagnosisCase')
    .find({}, { projection: { _id: 0, fraudDiagnosisCaseReference: 1 } })
    .toArray();
  let maxSeq = 1000;
  for (const r of existing as Array<{ fraudDiagnosisCaseReference?: string }>) {
    const m = /(\d+)\s*$/.exec(r.fraudDiagnosisCaseReference ?? '');
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  await db.collection<{ _id: string; seq: number }>('counters').updateOne(
    { _id: 'fraudDiagnosisCaseReference' },
    [{ $set: { seq: { $max: [{ $ifNull: ['$seq', 0] }, maxSeq] } } }],
    { upsert: true }
  );
}
