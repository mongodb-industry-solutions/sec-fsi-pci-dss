import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CARD_TRANSACTION_COLLECTION } from '../../modules/transaction/models/cardTransaction.model';
import {
  repointTransactionsToCards,
  type AgreementSeed,
  type CardSeed,
  type TransactionSeed,
} from './dataIntegrity';

const readFixture = <T>(name: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `../../../data/${name}`), 'utf-8'));

// v2: cardTransactions.json contains merged sensitive fields (rawGatewayPayload,
// processorTransactionMetadata). The QE client encrypts them with DEK-sensitive tier
// on write - no separate *Sensitive file.
export async function seedTransactions(db: Db) {
  const txns = readFixture<TransactionSeed>('cardTransactions.json');

  // v33 (F3): the card link is repaired here as well as in the generator (P7), against the same
  // fixtures the cards and agreements are seeded from, so a transaction can never point at a card
  // that does not exist or belongs to another party. Pure and idempotent: the fixtures are already
  // consistent, so a normal reseed changes nothing.
  const summary = repointTransactionsToCards(
    txns,
    readFixture<CardSeed>('paymentCards.json'),
    readFixture<AgreementSeed>('customerAgreements.json'),
  );

  for (const record of txns) {
    await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
      { cardTransactionInstanceReference: record.cardTransactionInstanceReference },
      { $set: record },
      { upsert: true }
    );
  }
  console.log(
    `  ${CARD_TRANSACTION_COLLECTION}: ${txns.length} upserted` +
    (summary.repointed > 0 || summary.maskedPanAligned > 0
      ? ` (${summary.repointed} repointed to a holder's card, ${summary.maskedPanAligned} masked PANs aligned)`
      : ''),
  );
  if (summary.unresolvable.length > 0) {
    console.warn(
      `  ${CARD_TRANSACTION_COLLECTION}: ${summary.unresolvable.length} transaction(s) whose account reference ` +
      'resolves to no card holder; run npm run generate:data to repair the fixtures',
    );
  }
}
