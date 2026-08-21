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
  for (const record of records) {
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
  console.log(`  ${PAYOUT_ACCOUNT_COLLECTION}: ${upserted} upserted (${backfilled} IBAN backfilled)`);

  // Link merchants to the bank account they are settled into
  for (const [merchantRef, payoutRef] of Object.entries(MERCHANT_SETTLEMENT_ACCOUNT)) {
    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantRef },
      { $set: { merchantDefaultPayoutAccountReference: payoutRef } },
    );
  }
  console.log(`  merchantAgreementProcedure: ${Object.keys(MERCHANT_SETTLEMENT_ACCOUNT).length} default payout accounts linked`);
}
