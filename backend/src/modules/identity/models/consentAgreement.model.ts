// Open Banking / Open Finance: Consent Agreement
// Stores customer consent grants for Third-Party Provider (TPP) access.
// Satisfies PSD2 (Payment Services Directive 2) and CDR (Consumer Data Right) audit requirements.
// This is a stub for v3 - full OAuth 2.0 / FAPI token validation is a v4 concern.

export const CONSENT_AGREEMENT_COLLECTION = 'consentAgreement';

export interface ConsentAgreementRecord {
  consentAgreementInstanceReference: string;           // PK, UUID
  partyInstanceReference: string;                      // FK to party (SD-13)
  customerAgreementInstanceReference: string;          // FK to customerAgreementProcedure (SD-53)
  consentGrantorRole: string;                          // always 'customer' for self-grant
  consentRecipientIdentifier: string;                  // TPP system identifier
  consentScopeGrants: ConsentScope[];
  consentStatus: ConsentStatus;
  consentGrantDateTime: Date;
  consentExpiryDateTime: Date;
  consentRevocationDateTime?: Date;
  consentRevocationReason?: string;
  consentRegulationFramework: 'PSD2' | 'CDR' | 'FAPI' | 'internal';
  consentPurpose: string;
  bianServiceDomain: 'Information Provider Operations';
  bianControlRecordType: 'InformationProviderOperations';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type ConsentStatus = 'active' | 'expired' | 'revoked' | 'pending';

export type ConsentScope =
  | 'read:profile'
  | 'read:transactions'
  | 'read:account_reference'
  | 'read:card_metadata'
  | 'read:fraud_status'
  | 'write:fraud_case';
