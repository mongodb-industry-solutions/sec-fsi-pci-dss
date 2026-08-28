// Party Authentication, ConsentGrant behavior qualifier
// Tracks which merchant OAuth clients a user has authorized, with scopes and revocation support.

export const PARTY_AUTH_CONSENT_COLLECTION = 'partyAuthConsent';

export type ConsentStatus = 'active' | 'revoked';
export type ConsentRevokedBy = 'user' | 'merchant' | 'psp';

export interface PartyAuthConsentRecord {
  consentId: string;                                  // UUID, primary key

  // Subject: the authenticated party who granted consent
  partyAuthenticationInstanceReference: string;       // FK → customerAuthenticationAssessment.sub

  // OAuth client that was granted consent
  oauthClientId: string;                              // FK → the oauthClient collection
  merchantAgreementInstanceReference: string;         // FK → merchantAgreementProcedure (denormalized for reads)
  merchantName: string;                               // Denormalized for display without a join

  // What was authorized
  grantedScopes: string[];                            // e.g. ['openid', 'profile', 'email']

  // Lifecycle
  consentStatus: ConsentStatus;
  consentGrantedAt: Date;
  consentRevokedAt?: Date;
  consentRevokedBy?: ConsentRevokedBy;
  lastUsedAt?: Date;                                  // Updated on each token refresh

  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianBehaviorQualifier: 'ConsentGrant';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
