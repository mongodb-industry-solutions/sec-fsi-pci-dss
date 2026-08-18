// Payment Initiation, Payout Account Arrangement
// Each PSP user can register 1‑N bank accounts. One is marked as default.
// Balance sub-doc tracks PSP internal ledger (pending / available / reserved).
// IBAN / routing number are QE:none (DEK-payout-iban), decrypted only by L2 client.

export const PAYOUT_ACCOUNT_COLLECTION = 'payoutAccountArrangement';

export type PayoutAccountType = 'bank_account' | 'wallet' | 'internal_ledger';
export type PayoutAccountStatus = 'active' | 'pending_validation' | 'suspended' | 'closed';
export type PayoutRail = 'sepa' | 'ach' | 'swift' | 'local_bank' | 'internal_wallet' | 'internal_ledger';

export interface PayoutAccountBalance {
  // All three fields updated atomically via MongoDB $inc, never read-modify-write.
  // authorized  → +pendingAmount
  // settled     → +availableAmount, -pendingAmount
  // refunded    → -availableAmount
  // dispute_hold → +reservedAmount, -availableAmount
  pendingAmount: number;
  availableAmount: number;
  reservedAmount: number;
  currency: string;         // ISO 4217, must match payoutAccountCurrency
  lastUpdatedDateTime: Date;
}

export interface PayoutAccountArrangement {
  payoutAccountInstanceReference: string;  // UUID, PK
  partyInstanceReference: string;          // FK → party 

  payoutAccountType: PayoutAccountType;
  payoutAccountStatus: PayoutAccountStatus;
  payoutAccountIsDefault: boolean;         // at most one true per party (partial unique index)

  // QE:none (DEK-payout-iban), returned as Binary ciphertext by L1; decrypted by L2 only
  payoutAccountIban?: string;              // ISO 13616 IBAN (15–34 chars)
  payoutAccountRoutingNumber?: string;     // ACH ABA routing number (US, 9 digits) or UK sort code (6 digits)

  // Plaintext banking metadata, not payment credentials (no PCI DSS encryption requirement)
  payoutAccountAlias?: string;             // user-defined nickname (max 60)
  payoutAccountBankName?: string;          // institution name (max 100)
  payoutAccountHolderName?: string;        // account holder legal name, (max 140)
  payoutAccountBicSwift?: string;          // ISO 9362 BIC/SWIFT: publicly published institution ID (8 or 11 chars)
  payoutAccountCorrespondentBic?: string;  // correspondent bank BIC for international wire transfers (8 or 11 chars)
  payoutAccountBankAddress?: string;       // bank branch address (max 200)
  payoutAccountCurrency: string;           // ISO 4217
  payoutAccountCountryCode: string;        // ISO 3166-1 alpha-2
  payoutAccountPreferredRail: PayoutRail;

  // PSP internal ledger (Payments, no external provider, MongoDB $inc only)
  payoutAccountBalance: PayoutAccountBalance;

  // v37: this record is a LINK to an account held at a registered bank. The money lives at the bank;
  // what stays here is which bank holds it, which account it is there, and the display metadata every
  // existing consumer already reads. `payoutAccountBalance` becomes a projection read through AIS.
  payoutAccountAspspReference?: string;        // FK → the bank in the ASPSP registry
  payoutAccountBankAccountReference?: string;  // FK → accountArrangement at that bank
  payoutAccountConsentReference?: string;      // FK → the PSD2 consent that authorises access
  // Last consent status the BANK told us (v37 P4.2/P4.6e). Written when a status-change notification
  // arrives, not on the next failed call, so a revoked link stops looking usable immediately. The
  // enumeration is Berlin Group's; anything other than `valid` means not usable.
  payoutAccountConsentStatus?: string;
  payoutAccountConsentStatusChangedDateTime?: Date;

  bianServiceDomain: 'Payment Initiation';
  bianControlRecordType: 'PayoutAccountArrangement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
