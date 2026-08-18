// PSD2 account access consent, the record that authorises a TPP to read a PSU's accounts and to
// initiate payments from them. Different from the PSP's own OAuth scope consent for merchants: neither
// replaces the other, and they live in different databases because they answer different questions.
export const BANK_CONSENT_AGREEMENT_COLLECTION = 'bankConsentAgreement';
export const BANK_CONSENT_ACCESS_LOG_COLLECTION = 'bankConsentAccessLog';

// Berlin Group's own enumeration, not a bespoke boolean. `received` is created but not yet usable,
// `valid` is usable, and the remaining four are terminal in different ways, which is why the PSP has to
// switch on the value rather than on a flag.
export type ConsentStatus =
  | 'received'
  | 'rejected'
  | 'valid'
  | 'revokedByPsu'
  | 'expired'
  | 'terminatedByTpp';

// What the consent grants, per the standard's access object. Stored as the bank's own account
// references rather than IBANs: the IBAN is already encrypted on the account record, and copying it
// here would store the same personal datum twice for no gain. It is resolved back to an IBAN on read.
//
// `payments` is the bank's OWN field and is deliberately not part of the standard access object, which
// covers account information only. It is derived from the account list at creation, so a TPP never asks
// for it and it is never returned: what it exists for is to let payment initiation go through the same
// single consent gate as the reads, rather than growing a second authorisation path.
export interface ConsentAccessScope {
  accounts: string[];
  balances: string[];
  transactions: string[];
  payments: string[];
}

export type ConsentAccessKind = 'accounts' | 'balances' | 'transactions' | 'payments';

export interface BankConsentAgreementControlRecord {
  // The standard's consentId.
  bankConsentAgreementInstanceReference: string;
  // Which registered TPP holds it. A consent is granted to one third party, not to the world.
  bankConsentTppClientId: string;
  bankConsentAccountHolderInstanceReference: string;
  bankConsentAccess: ConsentAccessScope;
  bankConsentRecurringIndicator: boolean;
  bankConsentFrequencyPerDay: number;
  bankConsentValidUntil: string;
  bankConsentStatus: ConsentStatus;
  // Why it holds this status. An automatic transition to `valid` records `tpp_registered`, so the
  // reason is visible rather than implicit in a configuration value nobody reads.
  bankConsentStatusReason: string;
  bankConsentStatusChangedDateTime: string;
  // The standard's lastActionDate: when the consent was last used or changed.
  bankConsentLastActionDate: string;
  bianServiceDomain: string;
  bianControlRecordType: 'CustomerAccessConsent';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// Evidence, and deliberately including refusals: "this TPP was denied this account under this consent"
// is the more interesting record of the two, and it is what makes enforcement auditable rather than
// asserted.
export interface BankConsentAccessLogRecord {
  bankConsentAccessLogInstanceReference: string;
  bankConsentAgreementInstanceReference: string;
  bankConsentTppClientId: string;
  accessedAccountReference?: string;
  accessedResourceKind: ConsentAccessKind | 'consent';
  accessDecision: 'granted' | 'refused';
  accessDecisionReason?: string;
  accessCorrelationId?: string;
  recordCreatedDateTime: string;
  schemaVersion: number;
}
