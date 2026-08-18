import { Db } from 'mongodb';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../aspsp/models/accountArrangement.model';
import { ACCOUNT_MOVEMENT_COLLECTION, AccountMovementRecord } from '../../aspsp/models/accountMovement.model';

// Account Information Service: the read side of the bank, shaped as Berlin Group NextGenPSD2.
//
// The internal record is a BIAN control record; what leaves the bank is the standard resource. That
// mapping happens here and nowhere else, so no proprietary field name can reach a TPP.

export interface BerlinGroupAmount {
  currency: string;
  amount: string;
}

export interface BerlinGroupBalance {
  balanceAmount: BerlinGroupAmount;
  // The specification's own enumeration. `interimAvailable` is spendable now, `expected` includes
  // what is booked but not settled, `blocked` is reserved against a hold.
  balanceType: 'interimAvailable' | 'expected' | 'blocked';
  lastChangeDateTime?: string;
}

export interface BerlinGroupAccount {
  resourceId: string;
  iban: string;
  currency: string;
  name?: string;
  product?: string;
  cashAccountType: 'CACC' | 'SVGS';
  status: 'enabled' | 'blocked' | 'deleted';
  bic?: string;
  balances?: BerlinGroupBalance[];
}

function accountStatus(status: AccountArrangementControlRecord['accountStatus']): BerlinGroupAccount['status'] {
  if (status === 'active') return 'enabled';
  return status === 'closed' ? 'deleted' : 'blocked';
}

// ISO 20022 renders an amount as a decimal STRING, not a float: a JSON number would lose cents on a
// large value and the specification is explicit about it.
function amount(value: number, currency: string): BerlinGroupAmount {
  return { currency, amount: value.toFixed(2) };
}

function toBalances(record: AccountArrangementControlRecord): BerlinGroupBalance[] {
  const { accountBalance: balance } = record;
  const lastChangeDateTime = new Date(balance.lastUpdatedDateTime).toISOString();
  const balances: BerlinGroupBalance[] = [
    { balanceAmount: amount(balance.availableAmount, balance.currency), balanceType: 'interimAvailable', lastChangeDateTime },
    { balanceAmount: amount(balance.availableAmount + balance.pendingAmount, balance.currency), balanceType: 'expected', lastChangeDateTime },
  ];
  if (balance.reservedAmount > 0) {
    balances.push({ balanceAmount: amount(balance.reservedAmount, balance.currency), balanceType: 'blocked', lastChangeDateTime });
  }
  return balances;
}

// `resourceId` is the standard's account handle, and it is the bank's own reference: the PSP already
// stores it on the linked record, so the two sides address the same account without a translation
// table that could drift.
export function toBerlinGroupAccount(record: AccountArrangementControlRecord, withBalances = false): BerlinGroupAccount {
  return {
    resourceId: record.accountArrangementInstanceReference,
    iban: record.accountIban,
    currency: record.accountCurrency,
    name: record.accountAlias,
    product: record.accountKind === 'savings' ? 'Savings Account' : 'Current Account',
    cashAccountType: record.accountKind === 'savings' ? 'SVGS' : 'CACC',
    status: accountStatus(record.accountStatus),
    bic: record.accountBic,
    ...(withBalances ? { balances: toBalances(record) } : {}),
  };
}

export async function findAccount(db: Db, resourceId: string): Promise<AccountArrangementControlRecord | null> {
  return db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOne({ accountArrangementInstanceReference: resourceId }, { projection: { _id: 0 } });
}

// Accounts of one holder. There is no "all accounts" read: an AIS call is always scoped to the PSU
// whose consent authorises it, so an unscoped list would be a data leak dressed as a convenience.
export async function listAccountsForHolder(db: Db, holderReference: string): Promise<AccountArrangementControlRecord[]> {
  return db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find({ accountHolderInstanceReference: holderReference }, { projection: { _id: 0 } })
    .sort({ accountArrangementInstanceReference: 1 })
    .toArray();
}

export interface BerlinGroupTransaction {
  transactionId: string;
  bookingDate: string;
  valueDate: string;
  transactionAmount: BerlinGroupAmount;
  remittanceInformationUnstructured?: string;
  // ISO 20022 bank transaction code, so a client classifies without parsing prose.
  bankTransactionCode?: string;
  // The PSP's own id for the payment, carried through so one query correlates both sides.
  endToEndId?: string;
}

// Debits are negative in the standard's transaction amount; the ledger stores direction separately.
function signedAmount(movement: AccountMovementRecord): number {
  return movement.movementDirection === 'debit' ? -movement.movementAmount : movement.movementAmount;
}

export async function listTransactions(
  db: Db,
  resourceId: string,
  options: { dateFrom?: string; dateTo?: string; limit?: number } = {},
): Promise<BerlinGroupTransaction[]> {
  const filter: Record<string, unknown> = { accountArrangementInstanceReference: resourceId };
  if (options.dateFrom || options.dateTo) {
    filter.movementValueDateTime = {
      ...(options.dateFrom ? { $gte: options.dateFrom } : {}),
      ...(options.dateTo ? { $lte: options.dateTo } : {}),
    };
  }
  const movements = await db.collection<AccountMovementRecord>(ACCOUNT_MOVEMENT_COLLECTION)
    .find(filter, { projection: { _id: 0 } })
    .sort({ movementValueDateTime: -1 })
    .limit(options.limit ?? 100)
    .toArray();

  return movements.map((movement) => ({
    transactionId: movement.accountMovementInstanceReference,
    bookingDate: movement.movementValueDateTime.slice(0, 10),
    valueDate: movement.movementValueDateTime.slice(0, 10),
    transactionAmount: amount(signedAmount(movement), movement.movementCurrency),
    remittanceInformationUnstructured: movement.movementRemittanceInformation,
    bankTransactionCode: movement.movementKind,
    endToEndId: movement.movementCorrelationId,
  }));
}
