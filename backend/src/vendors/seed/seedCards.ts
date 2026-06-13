import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';
import { rebuildCardRegistry } from '../../modules/customer/services/paymentCard.service';

export async function seedCards(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/paymentCards.json'), 'utf-8')
  );

  for (const record of records) {
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: record.paymentCardInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  // Build the physical-card registry (SD-88) from the seeded arrangements: one entry per token
  // with the distinct-holder count (the FDS/AML shared-card signal).
  const tokens = await rebuildCardRegistry(db);
  console.log(`  ${PAYMENT_CARD_COLLECTION}: ${records.length} upserted; registry rebuilt for ${tokens} cards`);
}
