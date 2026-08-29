// Append-only log of every TPP (Third-Party Provider) field access made under a consent grant.
// Same append-only pattern as fraudDiagnosisCaseEvents.
// Satisfies PCI DSS Requirement 10 and PSD2 access-log requirements simultaneously.

export const CONSENT_ACCESS_LOG_COLLECTION = 'consentAccessLog';

export interface ConsentAccessLogRecord {
  consentAccessLogInstanceReference: string;           // PK, UUID
  consentAgreementInstanceReference: string;           // FK to consentAgreement
  accessDateTime: Date;
  accessorIdentifier: string;                          // TPP system identifier
  accessedScopes: string[];
  accessedResourceType: string;                        // e.g. 'cardTransactionLog'
  accessedResourceReference?: string;                  // specific record UUID if applicable
  accessOutcome: 'granted' | 'denied' | 'partial';
  schemaVersion: number;
}
