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
}
