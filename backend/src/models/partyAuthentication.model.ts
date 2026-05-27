// BIAN SD-16: Party Authentication (demo-only: stores pre-seeded user accounts)

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthenticationQE';

export interface PartyAuthenticationControlRecord {
  partyAuthenticationInstanceReference: string;
  // QE equality: searchable by email (login lookup)
  authenticationUserEmailAddress: string;
  authenticationPasswordHash: string;
  authenticationUserRole: DemoUserRole;
  authenticationUserName: string;
  authenticationDomain: 'local' | 'msentra';
  accountStatus: 'active' | 'suspended';
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'PartyAuthentication';
  recordCreatedDateTime: Date;
}

export type DemoUserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor';
