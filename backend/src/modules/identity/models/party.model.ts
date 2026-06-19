// BIAN SD-13: Party Data Management
// CR: Party
// Authoritative identity record for any principal (customer, bank staff, external party).
// All other SDs reference this via partyInstanceReference. No credentials here.

export const PARTY_COLLECTION = 'party';

export interface PartyControlRecord {
  partyInstanceReference: string;           // PK, UUID
  // QE equality: searched by analysts (email/phone are PII)
  partyEmailAddress: string;
  partyMobilePhoneNumber: string;
  // Plaintext display fields
  partyName: string;
  partyType: PartyType;
  partyDateOfBirth?: string;                // ISO 8601 date string, QE:none in v2
  partyNationality?: string;                // ISO 3166-1 alpha-2
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'Party';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type PartyType = 'customer' | 'employee' | 'service_account';
