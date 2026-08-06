// BIAN SD-53: Customer Agreement
// CR: CustomerAgreementProcedure
// Stores the bank-customer agreement lifecycle. PII (email, phone, name) lives in
// party (SD-13 Party Data Management). Linked via partyInstanceReference.
//
// v2: Sensitive fields (address, govId, riskNotes) are merged into this single collection.
// Field-level protection is provided by QE:none encryption (DEK-sensitive tier).
// Level 1 QE client omits these fields from its encryptedFieldsMap → they are returned
// as ciphertext Binary and stripped from the response. Level 2 QE client includes all
// fields → auto-decrypted by the driver. See roleClients.ts and encryptedFieldsMaps.ts.

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreementProcedure';

export interface CustomerAgreementControlRecord {
  customerAgreementInstanceReference: string;
  partyInstanceReference: string;               // FK to party (SD-13)

  // QE:equality (DEK-lookup tier) - searchable, Level 1+
  customerAgreementReference: string;

  // QE:none (DEK-sensitive tier) - non-searchable, Level 2+ only
  // Present as decrypted value with L2 QE client; Binary ciphertext with L1 client.
  customerAgreementResidentialAddress?: ResidentialAddress;
  /**
   * @deprecated v27, removed from every read path and from the seeder in v32 (ADR-050).
   * Kept only so a database seeded before v32 still parses. NEVER read it, never write it, never
   * expose it in a response: customerAgreementGovernmentID is the single source of truth for the
   * identity document, and it is the only one that is searchable (QE:suffix on .number).
   */
  governmentIdentificationReference?: string;
  /** @deprecated v27: replaced by structured KYC verdict fields. Kept for back-compat; stop writing. */
  customerAgreementRiskNotes?: string;

  // v27 KYC identity (user-supplied at onboarding, SD-53).
  // customerAgreementGovernmentID sub-doc is plaintext; its scalar leaves are QE-encrypted:
  //   .number QE:suffix, .type/.issuingCountry QE:equality, .expiryDate QE:range.
  customerAgreementGovernmentID?: GovernmentID;
  customerAgreementTaxIDNumber?: string;          // QE:prefix (v27)
  customerAgreementOccupation?: string;           // QE:equality (v27, contention)
  customerAgreementSourceOfFunds?: string;        // QE:none L2 (v27)
  customerAgreementPurposeOfRelationship?: string; // QE:none L2 (v27)

  // Plaintext fields
  customerSegment: CustomerSegment;
  customerAgreementStatus: AgreementStatus;
  customerAgreementEnrollmentDate: Date;
  customerAgreementPreferredLanguage: string;
  // v4: recurring payment mandate
  customerAgreementPreferredPaymentCardReference?: string;

  // Ch-06: BQ:Step, KYC identity verification (BIAN SD-53 BQ:Step). PCI DSS Req 8.1.
  customerAgreementKycCheck?: CustomerAgreementKycCheck;

  bianServiceDomain: 'Customer Agreement';
  bianControlRecordType: 'CustomerAgreementProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export interface ResidentialAddress {
  streetAddress: string;
  city: string;
  postalCode: string;
  countryCode: string;
}

// v27: structured government identity document (SD-53). Parent sub-doc is plaintext;
// individual scalar leaves are QE-encrypted (see encryptedFieldsMaps.ts).
export interface GovernmentID {
  type: string;              // QE:equality (e.g. passport, national_id, driver_license)
  number: string;            // QE:suffix
  issuingCountry: string;    // QE:equality (ISO 3166-1 alpha-2)
  expiryDate: Date;          // QE:range
}

/** Returns true only when a QE:none field has been decrypted (i.e. not a Binary blob). */
export function isSensitiveDecrypted(field: unknown): boolean {
  if (field === undefined || field === null) return false;
  // MongoDB Binary objects have a 'buffer' property and a 'sub_type' number
  if (typeof field === 'object' && field !== null && 'sub_type' in field && 'buffer' in field) return false;
  return true;
}

// BQ:Step, KYC identity verification (BIAN SD-53 BQ:Step). PCI DSS Req 8.1.
export type KycCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

export interface CustomerAgreementKycCheck {
  customerAgreementKycCheckStatus: KycCheckStatus;
  customerAgreementKycCheckCompletedDate?: Date;
  customerAgreementKycCheckReference?: string;  // external provider ref (e.g. Jumio, Onfido)
  /** @deprecated v27: replaced by structured verdict fields below. Kept for back-compat; stop writing. */
  customerAgreementKycCheckNotes?: string;

  // v27 provider-produced (HRP screening) verdicts, structured + auditable.
  customerAgreementKycCheckRiskScore?: number;                        // 0-100, QE:range
  customerAgreementKycCheckRiskRating?: 'low' | 'medium' | 'high';    // QE:equality (contention)
  customerAgreementKycCheckPepStatus?: boolean;                       // QE:equality (contention)
  customerAgreementKycCheckSanctionsResult?: 'clear' | 'hit' | 'pending'; // QE:equality (contention)
  customerAgreementKycCheckScreeningProviderRef?: string;             // QE:none L2
}

export type CustomerSegment = 'retail' | 'premium' | 'corporate' | 'sme';
export type AgreementStatus =
  | 'initiated'
  | 'agreed'
  | 'active'
  | 'amended'
  | 'suspended'
  | 'dormant'
  | 'closed';
