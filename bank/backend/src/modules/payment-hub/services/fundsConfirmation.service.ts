import { Db } from 'mongodb';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../aspsp/models/accountArrangement.model';

// Confirmation of funds: the yes/no gate a card or a transfer is authorised against.
//
// The answer is deliberately ONLY a boolean. The whole point of this service under PSD2 is that a party
// asking "are there 40 euros" learns whether there are 40 euros and nothing else: returning the balance,
// or a reason that implies it, would turn a funds gate into an account information disclosure that the
// caller may have no basis for.

export interface FundsConfirmationInput {
  accountIban: string;
  amount: number;
  currency: string;
  // Account references the consent covers, so the decision is the consent's rather than the caller's.
  permittedAccountReferences: string[];
}

export type FundsConfirmationResult =
  | { ok: true; fundsAvailable: boolean; accountReference: string }
  // A refusal is different from "no funds": one is the request being wrong, the other is the answer.
  | { ok: false; status: 400 | 401 | 404; code: 'FORMAT_ERROR' | 'CONSENT_INVALID' | 'RESOURCE_UNKNOWN'; text: string };

export async function confirmFunds(db: Db, input: FundsConfirmationInput): Promise<FundsConfirmationResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'instructedAmount must be a positive amount' };
  }
  if (!input.currency) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'instructedAmount.currency is required' };
  }

  const account = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOne({ accountIban: input.accountIban }, { projection: { _id: 0 } });
  if (!account) {
    return { ok: false, status: 404, code: 'RESOURCE_UNKNOWN', text: 'the account is not held at this bank' };
  }
  // Checked against the resolved account, not the IBAN the caller sent: naming an account must not be
  // enough to be told anything about it.
  if (!input.permittedAccountReferences.includes(account.accountArrangementInstanceReference)) {
    return { ok: false, status: 401, code: 'CONSENT_INVALID', text: 'the consent does not cover this account' };
  }

  // A currency mismatch is answered as "no funds" rather than refused: the honest answer to "are there 40
  // dollars on this euro account" is no, and an error would tell a caller which currency it is held in.
  const fundsAvailable = account.accountStatus === 'active'
    && account.accountCurrency === input.currency
    && account.accountBalance.availableAmount >= input.amount;

  return { ok: true, fundsAvailable, accountReference: account.accountArrangementInstanceReference };
}
