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
  // `pending`: self-registered account awaiting manager approval (cannot log in until `active`).
  customerAuthenticationAccountStatus: 'active' | 'suspended' | 'pending';
  customerAuthenticationLastLoginDateTime?: Date;
  // Session validity counter (server-side logout / token invalidation). Every issued session JWT
  // embeds the epoch current at sign time; the auth middleware rejects a token whose epoch is behind
  // this value. Logout increments it, invalidating all of the user's outstanding stateless tokens
  // without storing any token. Optional runtime state: absent means epoch 0 (never invalidated).
  customerAuthenticationSessionEpoch?: number;
  // Demo-only: marks the curated roster surfaced in the debug-mode user picker
  // (application mode) and used by the simulator. Non-featured users remain
  // seeded and fully usable for testing.
  customerAuthenticationDemoFeatured?: boolean;
  bianServiceDomain: 'Customer Authentication';
  bianControlRecordType: 'CustomerAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type CustomerAuthRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'    // Ch-05: SD-89 Merchant Acquiring bank employee
  | 'operations_officer' // v29: SD-88/SD-66 cardholder & payout-account operations (built-in module admin)
  | 'manager';            // SD-193: Integration Hub administrator
