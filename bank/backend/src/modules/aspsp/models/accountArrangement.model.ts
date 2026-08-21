// The real account and its balance, owned by the bank. This is the collection the PSP no longer has:
// its `payoutAccountArrangement` keeps the link and the display metadata, the money lives here.
export const ACCOUNT_ARRANGEMENT_COLLECTION = 'accountArrangement';

export type AccountStatus = 'active' | 'blocked' | 'closed';
export type AccountKind = 'current' | 'savings';

export interface AccountBalance {
  // Spendable now. This is the figure the PSP projects as payoutAccountBalance.availableAmount.
  availableAmount: number;
  // Booked but not yet settled, in either direction.
  pendingAmount: number;
  // Held against a dispute or a card authorisation: not spendable, still the customer's.
  reservedAmount: number;
  currency: string;
  lastUpdatedDateTime: Date | string;
}

export interface AccountArrangementControlRecord {
  accountArrangementInstanceReference: string;
  // The bank's own account holder, NOT the PSP's party: two records describing the same human.
  accountHolderInstanceReference: string;
  bankProfileInstanceReference: string;
  accountKind: AccountKind;
  accountStatus: AccountStatus;
  accountAlias?: string;
  accountCurrency: string;
  accountCountryCode: string;
  // QE. GDPR and PSD2 minimisation: an IBAN is personal data, not cardholder data.
  accountIban: string;
  accountBic: string;
  accountMaskedIban: string;
  accountBalance: AccountBalance;
  accountOpenedDateTime: string;
  bianServiceDomain: string;
  bianControlRecordType: 'AccountArrangement';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
