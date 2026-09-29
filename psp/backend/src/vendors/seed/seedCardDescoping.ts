import { Db } from 'mongodb';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';

// Keeps the PSP's card records descoped: BIN, last four and a masked display, and no PAN anywhere.
//
// v37 P7 moved the vault to the bank, so this no longer derives a card number. The BIN and last four come
// from the bank's own issued-card registry, which is the record of what it put in customers' hands, so the
// two sides cannot drift and the derivation lives in exactly one place.
interface IssuedCard {
  paymentCardReference: string;
  paymentCardBin?: string;
  paymentCardLastFour?: string;
}

// Read from the bank's database, not its API: this runs at seed time, before either service is up.
async function issuedCards(db: Db): Promise<Map<string, IssuedCard>> {
  const bankDbName = process.env.PSP_BANKCORE_DB_NAME ?? 'bankcoredb';
  const rows = await db.client.db(bankDbName).collection<IssuedCard>('issuedCardRegistry')
    .find({}, { projection: { _id: 0, paymentCardReference: 1, paymentCardBin: 1, paymentCardLastFour: 1 } })
    .toArray();
  return new Map(rows.map((row) => [row.paymentCardReference, row]));
}

// Fallback for a PSP seeded without a bank: the last four is already in the fixture's masked display.
function lastFourFromFixture(): Map<string, string> {
  const path = join(__dirname, '../../../data/paymentCards.json');
  if (!existsSync(path)) return new Map();
  const cards = JSON.parse(readFileSync(path, 'utf8')) as Array<{ paymentCardReference?: string; paymentCardMaskedPanDisplay?: string }>;
  const byToken = new Map<string, string>();
  for (const card of cards) {
    const lastFour = String(card.paymentCardMaskedPanDisplay ?? '').replace(/\D/g, '').slice(-4);
    if (card.paymentCardReference && lastFour) byToken.set(card.paymentCardReference, lastFour);
  }
  return byToken;
}

export async function seedCardDescoping(db: Db): Promise<number> {
  const issued = await issuedCards(db).catch(() => new Map<string, IssuedCard>());
  const fixtureLastFour = lastFourFromFixture();
  const cards = await db.collection(PAYMENT_CARD_COLLECTION).find({}).toArray();
  let updated = 0;

  for (const card of cards) {
    const token = String(card.paymentCardReference ?? '');
    const fromBank = issued.get(token);
    const lastFour = fromBank?.paymentCardLastFour ?? fixtureLastFour.get(token);
    if (!lastFour) continue;

    // Several read paths return the masked display directly, so it stays populated rather than unset.
    // It exposes the last four only, which is what may be shown.
    const update: Record<string, string> = {
      paymentCardLast4: lastFour,
      paymentCardMaskedPanDisplay: `****-****-****-${lastFour}`,
    };
    if (fromBank?.paymentCardBin) update.paymentCardBin = fromBank.paymentCardBin;

    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: card.paymentCardInstanceReference },
      { $set: update },
    );
    updated += 1;
  }

  const source = issued.size > 0 ? "the bank's issued-card registry" : 'the local fixture (no bank reachable)';
  console.log(`  ${PAYMENT_CARD_COLLECTION}: ${updated} card(s) descoped from ${source}; no PAN written`);
  return updated;
}
