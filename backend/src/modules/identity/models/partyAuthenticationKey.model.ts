// SD-16: Party Authentication — RSA public key audit registry
// ADR-036 (FS-first): the OAuthKeyProvider (local filesystem / AWS KMS) is the single source
// of truth for key material. This collection is an AUDIT MIRROR only — it records key status
// and provenance (who rotated, when) and backs the admin dashboard listing. It is NOT read to
// verify tokens or to build the JWKS; those are served directly from the provider. The private
// key is never stored here.

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
