import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../modules/gateway/models/payoutAccount.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../modules/gateway/models/merchantAgreement.model';
import { generateDemoIban, generateDemoRouting } from '../../modules/gateway/services/payoutAccount.service';

// Merchant → their PSP internal ledger account (seeded alongside this file)
const MERCHANT_PAYOUT_LEDGER: Record<string, string> = {
  'm0000001-0000-4000-8000-000000000001': 'pao00001-0000-4000-8000-000000000001',
  'm0000002-0000-4000-8000-000000000002': 'pao00002-0000-4000-8000-000000000002',
  'm0000003-0000-4000-8000-000000000003': 'pao00003-0000-4000-8000-000000000003',
};

export async function seedPayoutAccounts(db: Db) {
  const filePath = path.join(__dirname, '../../../data/payoutAccounts.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  let backfilled = 0;
  for (const record of records) {
    // Every real bank account (and e-wallet) must carry banking identifiers. Backfill a valid,
    // DETERMINISTIC demo IBAN + routing when the seed data omits them (idempotent: keyed by the
    // account reference). internal_ledger is the PSP internal balance, not a bank account, so it
    // intentionally has no IBAN. QE encrypts these fields on write.
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

  // Link merchants to their default PSP ledger accounts
  for (const [merchantRef, payoutRef] of Object.entries(MERCHANT_PAYOUT_LEDGER)) {
    await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantRef },
      { $set: { merchantDefaultPayoutAccountReference: payoutRef } },
    );
  }
  console.log(`  merchantAgreementProcedure: ${Object.keys(MERCHANT_PAYOUT_LEDGER).length} default payout accounts linked`);
}
