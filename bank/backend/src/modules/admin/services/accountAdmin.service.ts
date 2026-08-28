import { Db } from 'mongodb';
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord, AccountStatus,
} from '../../aspsp/models/accountArrangement.model';

// The account lifecycle as the bank administers it: approve, block, close.
//
// It lives in a service rather than in the controller because the rules are the bank's, not the HTTP layer's,
// and because two routes reach the same act. An operator closing an account from its own screen and one moving
// it through the lifecycle must meet the same balance check; two copies of that check is one copy too many.

// Which transitions are legal. `pending_approval` is where an account waits for an operator, which is what
// makes an approval a real step rather than a button that always succeeds. `closed` is terminal, because
// reopening would let one reference mean two relationships over its history.
export const ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  pending_approval: ['active', 'closed'],
  active: ['blocked', 'closed'],
  blocked: ['active', 'closed'],
  closed: [],
};

export type AccountChangeRefusal =
  | { refusal: 'unknown_account' }
  | { refusal: 'illegal_transition'; from: AccountStatus; to: AccountStatus }
  | { refusal: 'holds_funds'; amount: number; currency: string };

export type AccountChangeResult =
  | { ok: true; accountReference: string; accountStatus: AccountStatus; unchanged?: true }
  | ({ ok: false } & AccountChangeRefusal);

/**
 * Moves an account to a status, or refuses and says why.
 *
 * Closing an account that still holds money is refused rather than performed, because the alternative is a
 * silent write-off: the funds would belong to a holder the bank no longer serves. The refusal carries the
 * figure, so an operator learns what has to happen first instead of only that it failed.
 */
export async function changeAccountStatus(
  db: Db, accountReference: string, target: AccountStatus,
): Promise<AccountChangeResult> {
  const collection = db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION);
  const account = await collection.findOne(
    { accountArrangementInstanceReference: accountReference },
    { projection: { _id: 0, accountStatus: 1, accountBalance: 1, accountCurrency: 1 } },
  );
  if (!account) return { ok: false, refusal: 'unknown_account' };
  if (account.accountStatus === target) {
    return { ok: true, accountReference, accountStatus: target, unchanged: true };
  }

  const allowed = ACCOUNT_TRANSITIONS[account.accountStatus] ?? [];
  if (!allowed.includes(target)) {
    return { ok: false, refusal: 'illegal_transition', from: account.accountStatus, to: target };
  }

  const available = account.accountBalance?.availableAmount ?? 0;
  if (target === 'closed' && available !== 0) {
    return { ok: false, refusal: 'holds_funds', amount: available, currency: account.accountCurrency };
  }

  // The balance is never touched here. A status is a status, and moving money is a posting.
  await collection.updateOne(
    { accountArrangementInstanceReference: accountReference },
    { $set: { accountStatus: target, recordUpdatedDateTime: new Date().toISOString() } },
  );
  return { ok: true, accountReference, accountStatus: target };
}

/** The message an operator reads. Kept next to the rule so the two cannot drift apart. */
export function describeRefusal(result: AccountChangeRefusal): string {
  switch (result.refusal) {
    case 'unknown_account':
      return 'No such account at this bank';
    case 'illegal_transition':
      return `An account cannot go from ${result.from} to ${result.to}`;
    case 'holds_funds':
      return `The account still holds ${result.amount.toFixed(2)} ${result.currency} `
        + 'and cannot be closed until it is empty';
  }
}
