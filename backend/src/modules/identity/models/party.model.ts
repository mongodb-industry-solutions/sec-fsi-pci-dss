// BIAN SD-13: Party Data Management
// CR: Party
// Authoritative identity record for any principal (customer, bank staff, external party).
// All other SDs reference this via partyInstanceReference. No credentials here.

export const PARTY_COLLECTION = 'party';

export interface PartyTransferPreferences {
  // Controls inbound transfer behaviour. Default: auto-accept all.
  inboundAutoAccept: boolean;
  // partyInstanceReference or merchantAgreementInstanceReference values to block
  blockedSenders: string[];
  // Require manual confirmation for transfers above this amount (0 = no threshold)
  requireConfirmationAboveAmount?: number;
  requireConfirmationAboveCurrency?: string; // ISO 4217
}

export interface PartyControlRecord {
  partyInstanceReference: string;           // PK, UUID
  // QE equality: searched by analysts (email/phone are PII)
  partyEmailAddress: string;
  partyMobilePhoneNumber: string;
  // Blind index: keyed HMAC of the normalized phone (NOT encrypted). Enforces phone
  // uniqueness via a plaintext unique index — QE fields cannot have unique indexes.
  // Derived from partyMobilePhoneNumber; never set by clients directly. See digest.ts.
  partyMobilePhoneNumberDigest: string;
  // Plaintext display fields
  partyName: string;
  partyType: PartyType;
  partyDateOfBirth?: string;                // ISO 8601 date string, QE:none in v2
  partyNationality?: string;                // ISO 3166-1 alpha-2
  // v17: inbound transfer preferences and sender block list
  partyTransferPreferences?: PartyTransferPreferences;
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'Party';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type PartyType = 'customer' | 'employee' | 'service_account';
