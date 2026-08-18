// The bank's record of a registered third party. Being registered and active is what authorises a TPP
// to operate this bank's accounts and cards, which is the whole authorisation model of this demo.
//
// The secret is held as a bcrypt hash and never in clear: the bank verifies, it does not disclose.
export const TPP_REGISTRATION_COLLECTION = 'tppRegistration';

// PSD2 roles. A TPP may hold several at once, as Leafy Pay does.
export type TppRole = 'AISP' | 'PISP' | 'CBPII';

export type TppRegistrationStatus = 'active' | 'suspended' | 'revoked';

// Scopes are per operation group. The AIS names are Berlin Group's own consent access types, so a
// standard client asks for what the specification already calls them.
export type TppScope =
  | 'accounts'
  | 'balances'
  | 'transactions'
  | 'payments'
  | 'funds-confirmations'
  | 'demo-credits';

export interface TppRegistrationControlRecord {
  tppRegistrationInstanceReference: string;
  tppRegistrationName: string;
  tppRegistrationClientId: string;
  // bcrypt, the same shape the PSP's own OAuth service compares.
  tppRegistrationClientSecretHash: string;
  tppRegistrationGrantedScopes: TppScope[];
  tppRegistrationRoles: TppRole[];
  tppRegistrationStatus: TppRegistrationStatus;
  tppRegistrationApiVersion: string;
  tppRegistrationEnvironment: 'sandbox' | 'production';
  // eIDAS certificate metadata is a placeholder so the omission is visible rather than implicit.
  tppRegistrationCertificate?: {
    certificateSubject?: string;
    certificateSerialNumber?: string;
    certificateNotImplementedReason: string;
  };
  bianServiceDomain: string;
  bianControlRecordType: 'TppRegistration';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// The seed fixture carries no secret hash: it is computed at seed time from the seed-time credential,
// so a fixture in the repository never holds a usable value.
export type TppRegistrationSeedRecord =
  Omit<TppRegistrationControlRecord, 'tppRegistrationClientId' | 'tppRegistrationClientSecretHash'>;
