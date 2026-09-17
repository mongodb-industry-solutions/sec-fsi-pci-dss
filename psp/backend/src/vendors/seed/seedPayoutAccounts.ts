import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../modules/gateway/models/payoutAccount.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../modules/gateway/models/merchantAgreement.model';
import { generateDemoIban, generateDemoRouting } from '../../modules/gateway/services/payoutAccount.service';

// Merchant → the bank account they are settled into. NOT a PSP-held balance any more (P2.7): a
// PSP that holds a merchant's funds is doing an EMI's job, and the ledger belongs at the bank.
const MERCHANT_SETTLEMENT_ACCOUNT: Record<string, string> = {
  'm0000001-0000-4000-8000-000000000001': 'pau00063-0000-4000-8000-000000000063',
  'm0000002-0000-4000-8000-000000000002': 'pau00064-0000-4000-8000-000000000064',
  'm0000003-0000-4000-8000-000000000003': 'pau00065-0000-4000-8000-000000000065',
};

export async function seedPayoutAccounts(db: Db) {
  const filePath = path.join(__dirname, '../../../data/payoutAccounts.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  let backfilled = 0;
  let retired = 0;
  for (const record of records) {
    /**
     * A record renamed its own reference names the OLD one here, so the seed can retire it rather
     * than leave it behind.
     *
     * Every other field here is upserted by reference, which is additive by construction: nothing
     * ever removes a document whose reference stopped appearing in the fixture. That is correct
     * for a live payout account a person added at runtime, and it is exactly wrong for a fixture
     * record that was renamed, which is what left Antonio Membrides' first account seeded twice,
     * under `pau00066` AND its replacement `pau00077`, both flagged default, both the same IBAN.
     *
     * Declared per record rather than inferred by diffing the collection against the fixture: an
     * inferred prune would delete anything a demo session created live between reseeds, which is
     * real data this seeder has no business touching. This only ever removes a reference an author
     * explicitly named as superseded, so it is exactly as targeted as an author intended.
     */
    const supersedes = Array.isArray(record.supersedes) ? (record.supersedes as string[]) : [];
    delete record.supersedes;
    if (supersedes.length) {
      const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).deleteMany({
        payoutAccountInstanceReference: { $in: supersedes },
      });
      retired += result.deletedCount ?? 0;
    }
    // Every real bank account (and e-wallet) must carry banking identifiers. Backfill a valid,
    // DETERMINISTIC demo IBAN + routing when the seed data omits them (idempotent: keyed by the
    // account reference). The only remaining internal_ledger is the PSP revenue account, which is
    // not a bank account and so intentionally has no IBAN. QE encrypts these fields on write.
    const type = record.payoutAccountType;
    if (type === 'bank_account' || type === 'wallet') {
      if (!record.payoutAccountIban) {
        record.payoutAccountIban = generateDemoIban(record.payoutAccountCountryCode ?? 'GB', record.payoutAccountInstanceReference);
        backfilled++;
      }
      if (!record.payoutAccountRoutingNumber) {
        record.payoutAccountRoutingNumber = generateDemoRouting(record.payoutAccountInstanceReference);
      }
    }
    await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
      { payoutAccountInstanceReference: record.payoutAccountInstanceReference },
      {
        $set: {
          ...record,
          payoutAccountBalance: {
            ...record.payoutAccountBalance,
            lastUpdatedDateTime: new Date(record.payoutAccountBalance.lastUpdatedDateTime),
          },
          recordCreatedDateTime: new Date(record.recordCreatedDateTime),
          recordUpdatedDateTime: new Date(record.recordUpdatedDateTime),
        },
      },
      { upsert: true },
    );
    upserted++;
  }
  console.log(
    `  ${PAYOUT_ACCOUNT_COLLECTION}: ${upserted} upserted (${backfilled} IBAN backfilled, ${retired} superseded reference(s) retired)`,
  );

  // Link merchants to the bank account they are settled into
  for (const [merchantRef, payoutRef] of Object.entries(MERCHANT_SETTLEMENT_ACCOUNT)) {
    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantRef },
      { $set: { merchantDefaultPayoutAccountReference: payoutRef } },
    );
  }
  console.log(`  merchantAgreementProcedure: ${Object.keys(MERCHANT_SETTLEMENT_ACCOUNT).length} default payout accounts linked`);
}
