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
    await db.collection('customerAgreementQE').updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  customerAgreementQE: ${agreements.length} upserted`);

  for (const record of sensitive) {
    await db.collection('customerAgreementSensitiveQE').updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  customerAgreementSensitiveQE: ${sensitive.length} upserted`);
}
