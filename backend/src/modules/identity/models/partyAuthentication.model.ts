// BIAN SD-16: Party Authentication (demo-only: stores pre-seeded user accounts)

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthentication';

export interface PartyAuthenticationControlRecord {
  partyAuthenticationInstanceReference: string;
  // QE equality: searchable by email (login lookup)
  partyAuthenticationUserEmailAddress: string;
  partyAuthenticationCredentialHash: string;
  partyAuthenticationUserRole: DemoUserRole;
  partyAuthenticationUserName: string;
  partyAuthenticationLoginDomain: 'local' | 'msentra';
  partyAuthenticationAccountStatus: 'active' | 'suspended';
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'PartyAuthentication';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type DemoUserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor';
