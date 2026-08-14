// (pricing) + (balances): merchant-commission collection.
//
// The commission is never added on top of what the buyer pays. The buyer is charged the gross amount;
// at settlement the PSP remits `netAmount` to the merchant and moves `feeAmount` into its own revenue
// account. This service owns the second leg, so the posting is double entry:
//   merchant pending  -= feeAmount        (the hold taken at authorization covered the gross)
//   PSP revenue avail += feeAmount
// Without it the merchant would be credited the gross while `feeAmount` claimed a collected commission.
//
// PCI DSS: every credit is mirrored in balanceCreditLog and in a businessProcessEvent.
// Operates only on PSP-internal UUID references, never on CHD.

import { Db } from 'mongodb';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import { BALANCE_CREDIT_LOG_COLLECTION, BalanceCreditLogEntry } from '../models/balanceCreditLog.model';
import { creditDirect, settleCardDebit } from './payoutAccountBalance.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';

// Deterministic references for the PSP's own revenue ledger (seeded by seedPspRevenueAccount).
// The PSP is a party like any other holder, so the account needs no special-case model.
export const PSP_REVENUE_PARTY_REFERENCE = 'psp00001-0000-4000-8000-000000000001';
export const PSP_REVENUE_ACCOUNT_REFERENCE = 'paop0001-0000-4000-8000-000000000001';

export interface PostCommissionInput {
  executionRef: string;
  // Originating acquiring transaction, carried into the audit event so the collection is findable by
  // transaction id and not only by execution reference.
  cardTransactionRef?: string;
  merchantReference: string;
  // Merchant account the commission is withheld from, and the fee expressed in THAT account's currency
  // (the caller derives it as grossConverted − netConverted so the pending hold always clears exactly).
  merchantAccountRef: string;
  feeAmount: number;
  currency: string;
  feeRateApplied?: number;
}

// Outcome of a posting attempt. The caller needs to tell the cases apart, because
// 'no_revenue_account' and 'fx_unavailable' leave the fee stranded in the merchant hold and need
// compensating: 'already_collected' means a previous run already withheld it.
export type PostCommissionOutcome = 'posted' | 'zero_fee' | 'already_collected' | 'no_revenue_account' | 'fx_unavailable';

// The outcomes where nothing was withheld and the hold still carries the fee, so the caller must
// release it to the merchant rather than leave money that belongs to nobody.
export function requiresFeeRelease(outcome: PostCommissionOutcome): boolean {
  return outcome === 'no_revenue_account' || outcome === 'fx_unavailable';
}

export interface PostCommissionResult {
  outcome: PostCommissionOutcome;
  creditedAmount: number; // amount credited to the PSP revenue account (0 unless outcome is 'posted')
}

// Post a collected commission.
// Idempotent: the credit id is derived from the execution, so a replayed settlement event is a no-op.
export async function postCommission(db: Db, input: PostCommissionInput): Promise<PostCommissionResult> {
  // Defensive: no rate configured, or a rounding artifact, means there is no commission to move.
  // Zero must leave every balance untouched (gross == net) rather than write a no-value ledger entry.
  if (!(input.feeAmount > 0)) return { outcome: 'zero_fee', creditedAmount: 0 };

  // Match the same condition creditDirect applies. A suspended or closed revenue account cannot be
  // credited, so accepting it here would debit the merchant hold and write the credit log for a leg
  // that silently never lands.
  const revenueAccount = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE, payoutAccountStatus: 'active' });
  if (!revenueAccount) {
    // Fail loudly in the log but never break the settlement: the merchant still gets its net amount,
    // and the caller releases the fee to it so no balance is left holding an uncollectable amount.
    console.error('[commission] PSP revenue account is not provisioned or not active, commission not posted');
    return { outcome: 'no_revenue_account', creditedAmount: 0 };
  }

  // Convert into the revenue account currency (same static rate table as the rest of the flow).
  // A failed conversion is an inability to post, never a reason to fall back to the unconverted
  // amount: crediting merchant-currency units into a revenue account denominated in another
  // currency would misstate both the balance and the credit log. The caller compensates.
  let creditAmount = input.feeAmount;
  if (revenueAccount.payoutAccountCurrency && revenueAccount.payoutAccountCurrency !== input.currency) {
    const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
    try { creditAmount = (await resolveAndConvert(db, input.feeAmount, input.currency, revenueAccount.payoutAccountCurrency)).amount; }
    catch {
      console.error(`[commission] FX ${input.currency}->${revenueAccount.payoutAccountCurrency} unavailable, commission not posted`);
      return { outcome: 'fx_unavailable', creditedAmount: 0 };
    }
  }

  const now = new Date();
  // Deterministic id → the upsert below is the idempotency gate for the whole posting.
  const creditId = `commission-${input.executionRef}`;
  const entry: BalanceCreditLogEntry = {
    creditId,
    payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE,
    partyInstanceReference: PSP_REVENUE_PARTY_REFERENCE,
    amount: creditAmount,
    currency: revenueAccount.payoutAccountCurrency,
    creditType: 'commission',
    description: `Merchant commission ${input.merchantReference}`,
    creditedAt: now,
    performedByPartyReference: null,
    referenceId: input.executionRef,
    bianServiceDomain: 'SD-66 Payout Account Arrangement',
    bianControlRecordType: 'PayoutAccountBalance',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };
  const res = await db.collection<BalanceCreditLogEntry>(BALANCE_CREDIT_LOG_COLLECTION)
    .updateOne({ creditId }, { $setOnInsert: entry }, { upsert: true });
  // Already collected for this execution: a previous run withheld it, so the hold is already correct.
  if (res.upsertedCount !== 1) return { outcome: 'already_collected', creditedAmount: 0 };

  // Withhold from the merchant hold, then credit the PSP. Order matters only for readability: both
  // legs are single-document $inc operations on payoutAccountArrangement.
  await settleCardDebit(db, input.merchantAccountRef, input.feeAmount);
  await creditDirect(db, PSP_REVENUE_ACCOUNT_REFERENCE, creditAmount);

  emitProcessEvent(db, {
    entityType: 'execution', entityId: input.executionRef,
    processType: 'payment_processing', processAction: 'merchant.commission.settled',
    processOutcome: 'settled',
    performedByPartyReference: null, performedByRole: null,
    eventSummary: {
      executionRef: input.executionRef,
      txnId: input.cardTransactionRef,
      merchantAgreementInstanceReference: input.merchantReference,
      merchantAccountRef: input.merchantAccountRef,
      feeAmount: input.feeAmount, feeCurrency: input.currency,
      creditedAmount: creditAmount, creditedCurrency: revenueAccount.payoutAccountCurrency,
      feeRateApplied: input.feeRateApplied,
      revenueAccountRef: PSP_REVENUE_ACCOUNT_REFERENCE,
    },
    bianServiceDomain: 'SD-66 Payout Account Arrangement',
    bianControlRecordType: 'PayoutAccountBalance',
  });

  return { outcome: 'posted', creditedAmount: creditAmount };
}
