// BIAN SD-16: Party Authentication
// CR: PartyAuthenticationAssessment
// Records identity VERIFICATION events for a party (e.g. "this party was verified via OTP").
// Credentials and role assignments belong in SD-91 customerAuthenticationAssessment.

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthenticationAssessment';

export interface PartyAuthenticationAssessmentRecord {
  partyAuthenticationInstanceReference: string;        // PK, UUID
  partyInstanceReference: string;                      // FK to party (SD-13)
  partyAuthenticationLoginDomain: 'local' | 'msentra';
  partyAuthenticationAccountStatus: 'active' | 'suspended';
  bianServiceDomain: 'Party Authentication';
  bianControlRecordType: 'PartyAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
