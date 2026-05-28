import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';

export async function seedCustomers(db: Db) {
  const agreements = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerAgreements.json'), 'utf-8')
  );
  const sensitive = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerAgreementsSensitive.json'), 'utf-8')
  );

  for (const record of agreements) {
    await db.collection('customerAgreement').updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  customerAgreement: ${agreements.length} upserted`);

  for (const record of sensitive) {
    await db.collection('customerAgreementSensitive').updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  customerAgreementSensitive: ${sensitive.length} upserted`);
}
