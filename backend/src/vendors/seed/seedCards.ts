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

  // Link each card to a payout account owned by its holder (BIAN SD-88 §cardAccountReference).
  // A card funds from exactly one account; an account may back several cards. The seed data may
  // spread a holder's cards across several of their own accounts (diversity for demo/testing), so
  // we HONOUR an explicit fundingPayoutAccountInstanceReference when it points to an active account
  // the same party owns. Only cards with a missing/stale/foreign reference are (re)linked to the
  // holder's default active account (bank_account preferred). This keeps the invariant that a card
  // never funds from an account belonging to another party.
  const { CUSTOMER_AGREEMENT_COLLECTION: AGR_COL } = await import('../../modules/customer/models/customerAgreement.model');
  const { PAYOUT_ACCOUNT_COLLECTION: PA_COL } = await import('../../modules/gateway/models/payoutAccount.model');

  const allCards = await db.collection(PAYMENT_CARD_COLLECTION).find({}).toArray();
  let linked = 0, keptExplicit = 0, alreadyCorrect = 0, noAccount = 0;

  for (const card of allCards) {
    const agreement = await db.collection(AGR_COL).findOne(
      { customerAgreementInstanceReference: card.customerAgreementInstanceReference },
      { projection: { partyInstanceReference: 1 } }
    );
    if (!agreement?.partyInstanceReference) { noAccount++; continue; }

    // Honour an explicit funding account when it is active and owned by this holder.
    const explicitRef = card.fundingPayoutAccountInstanceReference as string | undefined;
    if (explicitRef) {
      const explicitAccount = await db.collection(PA_COL).findOne(
        {
          payoutAccountInstanceReference: explicitRef,
          partyInstanceReference: agreement.partyInstanceReference,
          payoutAccountStatus: 'active',
        },
        { projection: { _id: 1 } }
      );
      if (explicitAccount) { keptExplicit++; continue; }
    }

    // Prefer bank_account as funding source; fall back to any default active account type.
    const account = await db.collection(PA_COL).findOne(
      {
        partyInstanceReference: agreement.partyInstanceReference,
        payoutAccountIsDefault: true,
        payoutAccountStatus: 'active',
      },
      { sort: { payoutAccountType: 1 } } // 'bank_account' < 'internal_ledger' < 'wallet' alphabetically
    );
    if (!account) { noAccount++; continue; }

    const newRef = account.payoutAccountInstanceReference as string;
    if (card.fundingPayoutAccountInstanceReference === newRef) { alreadyCorrect++; continue; }

    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: card.paymentCardInstanceReference },
      { $set: { fundingPayoutAccountInstanceReference: newRef } }
    );
    linked++;
  }
  console.log(`  ${PAYMENT_CARD_COLLECTION}: ${linked} relinked, ${keptExplicit} kept explicit, ${alreadyCorrect} already correct, ${noAccount} with no matching account`);
}
