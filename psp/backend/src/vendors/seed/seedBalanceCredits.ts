// Seeds initial-deposit records in balanceCreditLog for every payout account
// that has a positive availableAmount at seed time.
// PCI DSS: every fund credit must have an audit record.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../../modules/gateway/models/payoutAccount.model';
import { BALANCE_CREDIT_LOG_COLLECTION, BalanceCreditLogEntry } from '../../modules/gateway/models/balanceCreditLog.model';

export async function seedBalanceCredits(db: Db): Promise<void> {
  const col = db.collection<BalanceCreditLogEntry>(BALANCE_CREDIT_LOG_COLLECTION);
  const accounts = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION).find({}).toArray();

  let inserted = 0;
  for (const account of accounts) {
    // Opening deposit reconciles to the FULL balance (available + pending + reserved) so the credit
    // log fully explains the account balance: Σ(credits) − Σ(debits=0 at seed) == current balance.
    const bal = account.payoutAccountBalance;
    const available = (bal?.availableAmount ?? 0) + (bal?.pendingAmount ?? 0) + (bal?.reservedAmount ?? 0);
    if (available <= 0) continue;

    const existing = await col.findOne({
      payoutAccountInstanceReference: account.payoutAccountInstanceReference,
      creditType: 'initial_deposit',
    });
    if (existing) continue;

    const now = account.recordCreatedDateTime ?? new Date();
    const entry: BalanceCreditLogEntry = {
      creditId: uuidv4(),
      payoutAccountInstanceReference: account.payoutAccountInstanceReference,
      partyInstanceReference: account.partyInstanceReference,
      amount: available,
      currency: account.payoutAccountCurrency,
      creditType: 'initial_deposit',
      description: 'Account opening deposit',
      creditedAt: now,
      performedByPartyReference: null,
      bianServiceDomain: 'SD-66 Payout Account Arrangement',
      bianControlRecordType: 'PayoutAccountBalance',
      recordCreatedDateTime: now,
      schemaVersion: 1,
    };
    await col.insertOne(entry);
    inserted++;
  }

  console.log(`  ${BALANCE_CREDIT_LOG_COLLECTION}: ${inserted} initial-deposit entries inserted`);
}
