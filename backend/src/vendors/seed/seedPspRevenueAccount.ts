// Seeds the PSP's own revenue ledger: a party plus its payout account .
// Merchant commissions are credited here at settlement, so the collected fee has a real holder
// instead of existing only as a feeAmount field. No new collection and no new model: the PSP is a
// party like any other, of type service_account (it is a system-owned account, never a customer).
//
// Opens at ZERO so the balance is explained entirely by balanceCreditLog commission entries
// (seedBalanceCredits skips zero-balance accounts, so no opening deposit is invented for it).

import { Db } from 'mongodb';
import { PARTY_COLLECTION, PartyControlRecord } from '../../modules/identity/models/party.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../../modules/gateway/models/payoutAccount.model';
import {
  PSP_REVENUE_PARTY_REFERENCE,
  PSP_REVENUE_ACCOUNT_REFERENCE,
} from '../../modules/gateway/services/commissionSettlement.service';

const CREATED = new Date('2026-05-01T00:00:00.000Z');
const CURRENCY = 'EUR'; // matches every other seeded ledger account (see FR-v17-08 reconciliation)

export async function seedPspRevenueAccount(db: Db): Promise<void> {
  const party: PartyControlRecord = {
    partyInstanceReference: PSP_REVENUE_PARTY_REFERENCE,
    partyEmailAddress: 'treasury@psp.internal',
    partyName: 'PSP Treasury',
    partyType: 'service_account',
    bianServiceDomain: 'Party Data Management',
    bianControlRecordType: 'Party',
    recordCreatedDateTime: CREATED,
    recordUpdatedDateTime: CREATED,
    schemaVersion: 1,
  };
  await db.collection<PartyControlRecord>(PARTY_COLLECTION).updateOne(
    { partyInstanceReference: PSP_REVENUE_PARTY_REFERENCE },
    { $set: party },
    { upsert: true },
  );

  // internal_ledger: a PSP-internal balance, not a bank account, so it carries no IBAN (nothing for
  // QE to encrypt here) and is not marked default for any customer-facing listing.
  const account: PayoutAccountArrangement = {
    payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE,
    partyInstanceReference: PSP_REVENUE_PARTY_REFERENCE,
    payoutAccountType: 'internal_ledger',
    payoutAccountStatus: 'active',
    payoutAccountIsDefault: true,
    payoutAccountAlias: 'PSP Commission Revenue',
    payoutAccountBankName: 'PSP Internal Ledger',
    payoutAccountHolderName: 'PSP Treasury',
    payoutAccountCurrency: CURRENCY,
    payoutAccountCountryCode: 'US',
    payoutAccountPreferredRail: 'internal_ledger',
    payoutAccountBalance: {
      pendingAmount: 0,
      availableAmount: 0,
      reservedAmount: 0,
      currency: CURRENCY,
      lastUpdatedDateTime: CREATED,
    },
    bianServiceDomain: 'Payment Initiation',
    bianControlRecordType: 'PayoutAccountArrangement',
    recordCreatedDateTime: CREATED,
    recordUpdatedDateTime: CREATED,
    schemaVersion: 1,
  };
  // $setOnInsert on the balance: a reseed must never wipe commissions already collected.
  const { payoutAccountBalance, ...stable } = account;
  await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE },
    { $set: stable, $setOnInsert: { payoutAccountBalance } },
    { upsert: true },
  );

  console.log(`  ${PAYOUT_ACCOUNT_COLLECTION}: PSP revenue account ready (${PSP_REVENUE_ACCOUNT_REFERENCE})`);
}
