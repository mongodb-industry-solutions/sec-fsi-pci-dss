// SD-16: Party Authentication — RSA public key registry
// ADR-036: Only public key is stored. Private key is managed by OAuthKeyProvider (local file or AWS KMS).

export const PARTY_AUTHENTICATION_KEY_COLLECTION = 'partyAuthenticationKey';

export type AuthKeyStatus = 'active' | 'deprecated' | 'revoked';

export interface PartyAuthenticationKeyRecord {
  keyId: string;                      // UUID v4, matches JWT `kid` claim
  keyStatus: AuthKeyStatus;
  keyAlgorithm: 'RS256';
  keyModulusLength: 2048;
  publicKeyPem: string;               // PEM — safe to store and expose at /jwks (public by design)
  // NOTE: privateKeyPem is NEVER stored. See ADR-036.
  keyCreatedDateTime: Date;
  keyDeprecatedAt?: Date;             // Set when rotation puts a new key active
  keyRevokedAt?: Date;
  createdByPartyReference?: string;   // manager/system_admin who triggered generation
  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationKey';
  schemaVersion: number;
}
