// Party Authentication. User authenticator (WebAuthn/FIDO2 style) registry.
// Stores PUBLIC key material only (never private keys or biometric templates, PCI DSS).
// Distinct from partyAuthenticationKey (the OAuth signing-key audit mirror): this record is a
// first-class USER credential that backs passwordless CIBA approval and can later feed step-up/SCA.

export const PARTY_ENROLLED_CREDENTIAL_COLLECTION = 'partyEnrolledCredential';

export type EnrolledCredentialStatus = 'active' | 'revoked';
export type EnrolledCredentialAlg = 'RS256' | 'ES256';

export interface EnrolledCredentialAuthenticatorMetadata {
  deviceName?: string;              // user-supplied label, e.g. "MacBook Touch ID". PII, QE tier.
  aaguid?: string;                  // authenticator model id (non-PII)
  transports?: string[];            // e.g. ['internal'], ['usb','nfc'] (non-PII)
  createdVia?: string;              // 'psp-portal' | 'merchant-app' (provenance, non-PII)
}

export interface PartyEnrolledCredentialRecord {
  partyEnrolledCredentialInstanceReference: string; // PK, random UUID (uuidv4) assigned at enrollment
  // Owner. The login id (customerAuthenticationInstanceReference), i.e. the OAuth `sub`.
  customerAuthenticationInstanceReference: string;
  credentialId: string;             // opaque, unique per credential
  publicKeyPem: string;             // PUBLIC key only (SPKI PEM)
  alg: EnrolledCredentialAlg;       // RS256 or ES256 (polymorphic verifier selects per credential)
  signCount: number;                // monotonic anti-replay / anti-clone counter
  authenticatorMetadata: EnrolledCredentialAuthenticatorMetadata;
  status: EnrolledCredentialStatus;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'EnrolledCredential';
  schemaVersion: number;
}
