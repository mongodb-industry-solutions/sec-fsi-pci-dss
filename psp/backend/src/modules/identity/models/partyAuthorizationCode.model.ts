// Party Authentication, OAuth 2.0 Authorization Codes (BQ:Exchange)
// TTL index on expiresAt ensures automatic expiry after 5 minutes.

export const PARTY_AUTHORIZATION_CODE_COLLECTION = 'partyAuthorizationCode';

export interface PartyAuthorizationCodeRecord {
  code: string;                                  // UUID v4, opaque
  clientId: string;                              // FK → merchantAgreementProcedure.oauthClientId
  partyAuthenticationInstanceReference: string;  // FK → customerAuthentication sub (user who consented)
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;                        // S256 PKCE challenge
  codeChallengeMethod?: 'S256';
  state?: string;
  nonce?: string;
  usedAt?: Date;                                 // Set on exchange; prevents replay attacks
  expiresAt: Date;                               // 5 minutes from creation (TTL index)
  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthorizationCode';
  recordCreatedDateTime: Date;
}
