import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../modules/customer/models/customerAgreement.model';

// v2: customerAgreements.json contains merged sensitive fields (address, govId, riskNotes).
// The QE client encrypts them with DEK-sensitive tier on write - no separate *Sensitive file.
export async function seedCustomers(db: Db) {
  const agreements = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerAgreements.json'), 'utf-8')
  );

  for (const record of agreements) {
    await db.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(`  ${CUSTOMER_AGREEMENT_COLLECTION}: ${agreements.length} upserted`);
}
