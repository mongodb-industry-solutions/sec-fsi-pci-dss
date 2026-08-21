// The bank's own identity and, more importantly, its routing keys. Seeded data, never configuration,
// so adding a second bank later is a record rather than a code change.
//
// Every identifier here is the one the industry already uses, so routing needs no invented field:
// BIC (ISO 9362) and the IBAN bank code (ISO 13616) decide which bank holds an account, and the
// BIN/IIN (ISO/IEC 7812) decides which issuer owns a card.
export const BANK_PROFILE_COLLECTION = 'bankProfile';

export type BankRail = 'sepa' | 'sepa_instant' | 'ach' | 'swift' | 'book_transfer';

// Capabilities the bank offers the PSP. A capability absent here fails with a reason, never a
// silent fallback to another provider.
export type BankCapability =
  | 'aspsp'
  | 'account_information'
  | 'payment_initiation'
  | 'funds_confirmation'
  | 'card_issuer'
  | 'card_authorization'
  | 'credit_bureau';

export interface BinRange {
  // Inclusive range of leading PAN digits this bank issues, as digit strings of equal length.
  binRangeFrom: string;
  binRangeTo: string;
  binRangeScheme?: 'visa' | 'mastercard' | 'amex';
}

export interface BankProfileControlRecord {
  bankProfileInstanceReference: string;
  bankProfileName: string;
  bankProfileLegalName: string;
  bankProfileCountryCode: string;
  // ISO 9362. The bank is identified by this everywhere a BIC is expected.
  bankProfileBic: string;
  // ISO 13616 national bank identifiers this bank owns, so an IBAN resolves to it without a lookup.
  // One entry per country it operates in: a single institution with branches, not several banks.
  bankProfileIbanBankCodes: string[];
  bankProfileCountriesServed?: string[];
  // Which national code belongs to which country, so an IBAN is built and read the same way on both
  // sides. bankProfileIbanBankCodes stays the flat list the router matches against.
  bankProfileNationalBankCodeByCountry?: Record<string, string>;
  // Published coordinates a real counterparty would use: correspondent for cross-border legs, and the
  // registered address that appears on a transfer advice.
  bankProfileCorrespondentBic?: string;
  bankProfileAddress?: string;
  bankProfileWebsite?: string;
  // ISO/IEC 7812 ranges this bank issues cards in.
  bankProfileBinRanges: BinRange[];
  bankProfileSupportedRails: BankRail[];
  bankProfileCapabilities: BankCapability[];
  bankProfileStatus: 'active' | 'suspended';
  bianServiceDomain: string;
  bianControlRecordType: 'BankProfile';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
