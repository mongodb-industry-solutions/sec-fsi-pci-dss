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

// BIAN SD-13 Party Reference Data — postal contact point. Applies uniformly to any party
// type (customer or employee). PII under GDPR; stored plaintext for display (same posture as
// partyName / partyDateOfBirth in this record — this is not PCI-scoped card data).
export interface PartyPostalAddress {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  countryCode: string;                      // ISO 3166-1 alpha-2
}

export interface PartyControlRecord {
  partyInstanceReference: string;           // PK, UUID
  // QE equality: searched by analysts (email/phone are PII)
  partyEmailAddress: string;
  // Optional: a self-registered party may omit the phone. When absent, the uniqueness digest
  // is also absent and the (partial) unique index skips the document. See createIndexes.ts.
  partyMobilePhoneNumber?: string;
  // Blind index: keyed HMAC of the normalized phone (NOT encrypted). Enforces phone
  // uniqueness via a plaintext partial unique index — QE fields cannot have unique indexes.
  // Derived from partyMobilePhoneNumber; never set by clients directly. See digest.ts.
  partyMobilePhoneNumberDigest?: string;
  // Plaintext display fields
  partyName: string;
  partyType: PartyType;
  partyDateOfBirth?: string;                // ISO 8601 date string, QE:none in v2
  partyNationality?: string;                // ISO 3166-1 alpha-2
  partyPostalAddress?: PartyPostalAddress;  // SD-13 postal contact point (customer + employee)
  // v17: inbound transfer preferences and sender block list
  partyTransferPreferences?: PartyTransferPreferences;
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'Party';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type PartyType = 'customer' | 'employee' | 'service_account';
