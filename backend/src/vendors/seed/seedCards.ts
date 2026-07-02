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

  // Link each card to the customer's default bank_account payout account (debit card model, BIAN SD-88 §cardAccountReference)
  const { CUSTOMER_AGREEMENT_COLLECTION: AGR_COL } = await import('../../modules/customer/models/customerAgreement.model');
  const { PAYOUT_ACCOUNT_COLLECTION: PA_COL } = await import('../../modules/gateway/models/payoutAccount.model');

  const allCards = await db.collection(PAYMENT_CARD_COLLECTION).find({}).toArray();
  let linked = 0;
  for (const card of allCards) {
    if (card.fundingPayoutAccountInstanceReference) continue; // already linked
    const agreement = await db.collection(AGR_COL).findOne(
      { customerAgreementInstanceReference: card.customerAgreementInstanceReference },
      { projection: { partyInstanceReference: 1 } }
    );
    if (!agreement?.partyInstanceReference) continue;
    const account = await db.collection(PA_COL).findOne({
      partyInstanceReference: agreement.partyInstanceReference,
      payoutAccountIsDefault: true,
      payoutAccountType: 'bank_account',
      payoutAccountStatus: 'active',
    });
    if (!account) continue;
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: card.paymentCardInstanceReference },
      { $set: { fundingPayoutAccountInstanceReference: account.payoutAccountInstanceReference } }
    );
    linked++;
  }
  if (linked > 0) console.log(`  ${PAYMENT_CARD_COLLECTION}: ${linked} cards linked to default payout accounts`);
}
