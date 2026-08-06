// SD-16: Party Authentication, OAuth 2.0 Issued Tokens (BQ:Grant)
// TTL index on expiresAt ensures automatic cleanup after expiry.
// Access tokens are JWTs (not stored in full); refresh tokens are opaque UUIDs stored here.

import { OAuthGrantType } from '../../gateway/models/merchantAgreement.model';

export const PARTY_ISSUED_TOKEN_COLLECTION = 'partyIssuedToken';

export interface PartyIssuedTokenRecord {
  tokenId: string;                               // UUID v4 (jti for access tokens; opaque id for refresh)
  tokenType: 'access' | 'refresh';
  clientId: string;                              // FK → merchantAgreementProcedure.oauthClientId
  sub: string;                                   // Subject: userRef (auth code) or clientId (client_credentials)
  scopes: string[];
  grantType: OAuthGrantType;
  accessTokenJti?: string;                       // jti of the linked access token (on refresh token records)
  revokedAt?: Date;                              // Set on explicit revocation
  expiresAt: Date;                               // TTL index
  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'IssuedToken';
  recordCreatedDateTime: Date;
}
