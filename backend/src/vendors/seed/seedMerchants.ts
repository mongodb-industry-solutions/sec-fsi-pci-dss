// Ch-05: Seed merchantAgreementProcedure (SD-89) with demo merchant records.
// Includes: 1 active (dual-role owner), 1 under_review (pending approval), 1 active (standalone).

import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../modules/gateway/models/merchantAgreement.model';

export async function seedMerchants(db: Db) {
  const filePath = path.join(__dirname, '../../../data/merchants.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: record.merchantAgreementInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${MERCHANT_AGREEMENT_COLLECTION}: ${upserted} upserted`);
}
