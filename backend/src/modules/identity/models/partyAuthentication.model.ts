// Party Authentication
// CR: PartyAuthenticationAssessment
// Records identity VERIFICATION events for a party (e.g. "this party was verified via OTP").
// Credentials and role assignments belong in customerAuthenticationAssessment.

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthenticationAssessment';

export interface PartyAuthenticationAssessmentRecord {
  partyAuthenticationInstanceReference: string;        // PK, UUID
  partyInstanceReference: string;                      // FK to party 
  partyAuthenticationLoginDomain: 'leafypay' | 'msentra';
  partyAuthenticationAccountStatus: 'active' | 'suspended';
  bianServiceDomain: 'Party Authentication';
  bianControlRecordType: 'PartyAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
