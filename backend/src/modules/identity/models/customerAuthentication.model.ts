// BIAN SD-91: Customer Authentication
// CR: CustomerAuthenticationAssessment
// Owns login credentials, role assignments, and account access state.
// Linked to party (SD-13) via partyInstanceReference.

export const CUSTOMER_AUTHENTICATION_COLLECTION = 'customerAuthenticationAssessment';

export interface CustomerAuthenticationAssessmentRecord {
  customerAuthenticationInstanceReference: string;     // PK, UUID
  partyInstanceReference: string;                      // FK to party (SD-13)
  // QE equality: used for login lookup
  customerAuthenticationEmailAddress: string;
  customerAuthenticationCredentialHash: string;        // bcrypt 12-round, NOT QE-encrypted
  customerAuthenticationUserRole: CustomerAuthRole;
  customerAuthenticationUserName: string;              // denormalized display name for JWT
  customerAuthenticationLoginDomain: 'local' | 'msentra';
  customerAuthenticationAccountStatus: 'active' | 'suspended';
  customerAuthenticationLastLoginDateTime?: Date;
  bianServiceDomain: 'Customer Authentication';
  bianControlRecordType: 'CustomerAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type CustomerAuthRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor';
