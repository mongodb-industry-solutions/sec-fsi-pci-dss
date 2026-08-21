import { PayoutAccountArrangement } from '../models/payoutAccount.model';
import { readAccountBalance, type AisReadResult } from '../../../providers/account-information/services/bankcoreAis.client';
import { config } from '../../../config';

// P2.4: the balance the PSP reports becomes a PROJECTION read from AIS, at the identical field path
// (`payoutAccountBalance.availableAmount`) that Leafy Wallet and the frontend already parse. The money
// lives at the bank; the PSP holds the link.
//
// Behind the kill switch by construction: with it off, nothing here runs and the stored balance is
// returned exactly as before. With it on, a linked account's balance comes from the institution that
// holds it, which is the whole point of moving the ledger.

// A stale balance is never invented. When the read fails the stored value is kept and the record is
// marked, so a caller can tell "this is the bank's figure" from "this is the last one we saw".
export type BalanceSource = 'bank' | 'stored';

export interface ProjectedAccount extends PayoutAccountArrangement {
  payoutAccountBalanceSource?: BalanceSource;
  payoutAccountBalanceStaleReason?: string;
}

function isLinked(account: PayoutAccountArrangement): boolean {
  return Boolean(account.payoutAccountBankAccountReference && account.payoutAccountAspspReference);
}

// The reader is injected so the failure path is testable without mocking a module: a leaked module mock
// is how one test's stub silently answers another test's call.
export type BalanceReader = (input: {
  bankAccountReference: string; consentReference: string; correlationId?: string;
}) => Promise<AisReadResult>;

async function projectOne(
  account: PayoutAccountArrangement,
  correlationId?: string,
  read: BalanceReader = readAccountBalance,
): Promise<ProjectedAccount> {
  // An account with no bank link has no bank to ask: the PSP revenue ledger, for instance.
  if (!isLinked(account)) return account;

  // A link with no consent is not readable, and the bank is right to refuse it. Saying so here beats
  // sending a request that can only come back as a refusal, and it names the actual cause.
  if (!account.payoutAccountConsentReference) {
    return {
      ...account,
      payoutAccountBalanceSource: 'stored',
      payoutAccountBalanceStaleReason: 'no account access consent on this link',
    };
  }

  const { balance, error } = await read({
    bankAccountReference: account.payoutAccountBankAccountReference!,
    consentReference: account.payoutAccountConsentReference,
    correlationId,
  });

  if (!balance) {
    return { ...account, payoutAccountBalanceSource: 'stored', payoutAccountBalanceStaleReason: error };
  }
  return {
    ...account,
    payoutAccountBalance: {
      ...account.payoutAccountBalance,
      availableAmount: balance.availableAmount,
      pendingAmount: balance.pendingAmount,
      reservedAmount: balance.reservedAmount,
      currency: balance.currency,
      lastUpdatedDateTime: balance.lastUpdatedDateTime
        ? new Date(balance.lastUpdatedDateTime)
        : account.payoutAccountBalance.lastUpdatedDateTime,
    },
    payoutAccountBalanceSource: 'bank',
  };
}

export async function projectBalances(
  accounts: PayoutAccountArrangement[],
  correlationId?: string,
  read?: BalanceReader,
): Promise<ProjectedAccount[]> {
  if (!config.bankcore.enabled) return accounts;
  // Concurrent, because a page of accounts would otherwise cost one round trip each in sequence.
  return Promise.all(accounts.map((account) => projectOne(account, correlationId, read)));
}

export async function projectBalance(
  account: PayoutAccountArrangement,
  correlationId?: string,
  read?: BalanceReader,
): Promise<ProjectedAccount> {
  if (!config.bankcore.enabled) return account;
  return projectOne(account, correlationId, read);
}
