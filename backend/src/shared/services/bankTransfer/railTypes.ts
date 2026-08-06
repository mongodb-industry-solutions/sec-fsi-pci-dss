// v17.1 Bank Transfer rail engine: shared types, requirements and standard return-code maps.
// Single source of truth (DRY): rail unions, error codes and requirements are defined once here
// and imported everywhere (providers, orchestrator, API, tests). No duplication per flow.
//
// Compliance: ISO 13616 (IBAN), ISO 9362 (BIC), NACHA (ACH return codes),
// ISO 20022 (SEPA reject reasons), no deviation from BIAN SD-65/66.

import type { PayoutRail } from '../../../modules/gateway/models/payoutAccount.model';

// The external bank-transfer rails this engine can route (subset of PayoutRail).
export type BankRail = Extract<PayoutRail, 'sepa' | 'ach' | 'swift' | 'local_bank'>;

export const BANK_RAILS: readonly BankRail[] = ['sepa', 'ach', 'swift', 'local_bank'] as const;

// EEA / SEPA participating country codes (ISO 3166-1 alpha-2): abbreviated to the core scheme area.
export const SEPA_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'CH', 'GB', 'MC', 'SM', 'VA', 'AD',
]);

// The banking coordinates for a transfer destination (registered or transaction-scoped).
export interface RailDestination {
  countryCode: string;            // ISO 3166-1 alpha-2
  currency: string;               // ISO 4217
  iban?: string;                  // ISO 13616
  accountNumber?: string;         // domestic account number (ACH / local)
  routingNumber?: string;         // ACH ABA routing (US, 9 digits)
  bic?: string;                   // ISO 9362
  correspondentBic?: string;      // SWIFT correspondent bank

  // Display metadata (not payment credentials): retained only in masked/plaintext-safe form so
  // the recipient can be shown and traced without exposing the full IBAN (PCI DSS Req 3.3).
  beneficiaryName?: string;       // account holder legal name as entered at initiation (max 140)
  bankName?: string;              // recipient institution name (max 100)
}

export type RecurringScheme = 'ach_direct_debit' | 'sepa_sdd';

export interface RecurringMandate {
  scheme: RecurringScheme;
  mandateRef: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}

// Result of validating a destination against a rail's requirements.
export interface RailValidation {
  ok: boolean;
  rail: BankRail;
  errors: string[];               // human-readable reasons (also drive the reject code)
}

// Standard return / reject codes surfaced to callers and the UI.
// NACHA ACH return codes (subset).
export const ACH_RETURN_CODES: Record<string, string> = {
  R01: 'Insufficient funds',
  R02: 'Account closed',
  R03: 'No account / unable to locate account',
  R04: 'Invalid account number',
  R16: 'Account frozen',
  R20: 'Non-transaction account',
};

// ISO 20022 SEPA reject reason codes (subset).
export const SEPA_REJECT_CODES: Record<string, string> = {
  AC01: 'Incorrect account number (IBAN invalid)',
  AC04: 'Closed account number',
  AC06: 'Blocked account',
  AM04: 'Insufficient funds',
  MD07: 'End customer deceased',
};

// SWIFT / cross-border error codes (engine-defined, mapped from network conditions).
export const SWIFT_ERROR_CODES: Record<string, string> = {
  SW01: 'Invalid BIC',
  SW02: 'Correspondent bank unreachable',
  SW03: 'Unsupported corridor',
  SW04: 'Transfer fee not covered',
};

// Rail-agnostic engine errors.
export const RAIL_ERROR_CODES: Record<string, string> = {
  UNSUPPORTED_CORRIDOR: 'No supported rail for this country/currency/data combination',
  INVALID_DESTINATION: 'Destination banking details failed validation',
  RAIL_MISMATCH: 'Selected rail is not valid for the destination',
};
