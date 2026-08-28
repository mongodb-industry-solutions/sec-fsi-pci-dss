// The bank's record of a registered third party. Being registered and active is what authorises a TPP
// to operate this bank's accounts and cards, which is the whole authorisation model of this demo.
//
// The secret is held as a bcrypt hash and never in clear: the bank verifies, it does not disclose.
export const TPP_REGISTRATION_COLLECTION = 'tppRegistration';

// PSD2 roles. A TPP may hold several at once, as LeafyPay does.
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
  // The issuer's own operation, so not a Berlin Group scope: a card authorisation places a HOLD, which is
  // strictly more than reading a balance, and it is granted separately for that reason.
  | 'card-authorisations'
  // Cardholder data: an exact-PAN search and an ephemeral PAN reveal. Its OWN scope, deliberately not
  // folded into the one above, because a token that can place a hold must not thereby be able to read a
  // card number. That separation is the point of granting it apart.
  | 'card-data'
  // A credit assessment: also not a Berlin Group scope, and granted apart because reading someone's
  // creditworthiness is a different permission from moving their money.
  | 'credit-assessments'
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
