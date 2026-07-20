// BIAN Directory Entry: thin alias → party/counterparty resolution cache (v28).
// GDPR-minimized: no plaintext alias in the index (aliasHash = SHA-256(alias)). TTL-expired.
// Kept minimal for the demo; backs the identity/counterparty resolution step.

export const RTP_ALIAS_DIRECTORY_CACHE_COLLECTION = 'rtpAliasDirectoryCache';

export interface RtpAliasDirectoryCache {
  aliasHash: string;                    // SHA-256(alias), PK (unique index) — non-reversible
  resolvedPartyReference?: string;      // FK → party
  resolvedCounterpartyReference?: string; // FK → counterpartyArrangement
  resolvedPspId?: string;
  lastVerifiedAt: Date;
  expiresAt: Date;                      // TTL
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'PartyReferenceDataDirectoryEntry';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
