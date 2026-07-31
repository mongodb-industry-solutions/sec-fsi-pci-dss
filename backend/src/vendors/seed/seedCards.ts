import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';
import { rebuildCardRegistry } from '../../modules/customer/services/paymentCard.service';

/** Deterministic per-card seed so a reseed yields the same data. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Card expiry is derived from the seed run date, never hardcoded: a fixture value like
 * "12/28" silently rots (a card the demo calls active drifts into the past) and it can
 * contradict the card status. So the generator keeps MM/YY consistent with the status:
 * an expired card sits in the past, an active/blocked one in the future, and about one
 * in eight actives expires within 90 days for the renewal/expiry demo.
 * An explicit fixture value still wins, for cards a scenario pins on purpose.
 */
function cardExpiry(reference: string, status: string, now: Date): string {
  const seed = hash(reference);
  const monthsFromNow = status === 'expired'
    ? -(1 + (seed % 24))                       // 1 to 24 months in the past
    : seed % 8 === 0
      ? 1 + (seed % 3)                         // expires within the next 3 months
      : 12 + (seed % 48);                      // 1 to 5 years out
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsFromNow, 1));
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
}

export async function seedCards(db: Db) {
  const records = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/paymentCards.json'), 'utf-8')
  );

  const now = new Date();
  for (const record of records) {
    if (!record.paymentCardExpirationDate) {
      record.paymentCardExpirationDate = cardExpiry(
        record.paymentCardInstanceReference,
        record.paymentCardStatus,
        now
      );
    }
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

    // Prefer the holder's default active account (bank_account first). Safety net: if none is marked
    // default, fall back to ANY active bank_account the holder owns, so EVERY card ends up funded by
    // a bank account (invariant: a card is always assigned to a bank account of its owner).
    const account =
      await db.collection(PA_COL).findOne(
        {
          partyInstanceReference: agreement.partyInstanceReference,
          payoutAccountIsDefault: true,
          payoutAccountStatus: 'active',
        },
        { sort: { payoutAccountType: 1 } }, // 'bank_account' < 'internal_ledger' < 'wallet' alphabetically
      )
      ?? await db.collection(PA_COL).findOne(
        {
          partyInstanceReference: agreement.partyInstanceReference,
          payoutAccountType: 'bank_account',
          payoutAccountStatus: 'active',
        },
        { sort: { recordCreatedDateTime: 1 } },
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
