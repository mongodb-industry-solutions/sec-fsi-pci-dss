// The issuer's card vault: the only place a full PAN exists on this platform.
//
// It lives here because PCI DSS assigns scope to whoever stores a PAN, and that is the institution that
// issued the card. The PSP keeps a surrogate token plus BIN and last four, which is what descopes it.
// Two tokenisations coexist and neither replaces the other, mirroring the EMVCo split between acceptance
// tokens and issuer tokens.
export const CARD_ISSUER_VAULT_COLLECTION = 'cardIssuerVault';
export const ISSUED_CARD_REGISTRY_COLLECTION = 'issuedCardRegistry';

export type IssuedCardStatus = 'issued' | 'active' | 'suspended' | 'revoked';

// Every card this bank issues today is a DEBIT card: it draws on a funding account the bank holds, and an
// authorisation is a hold against that balance. The field exists so that is stated rather than assumed, and
// so a credit card can arrive later as a value here plus the things only credit needs (a limit that is not a
// balance, a statement cycle, interest) instead of as a migration of every existing record.
export type IssuedCardKind = 'debit' | 'credit';

// Set by the issuer per card, and judged on every authorisation. Only the per-transaction ceiling is
// enforced: a daily one needs a per-card tally of the day's authorisations, which nothing here keeps yet,
// and a limit that silently does nothing is worse than an absent one.
export interface IssuedCardLimits {
  perTransactionAmount?: number;
  limitCurrency?: string;
}

export interface CardIssuerVaultRecord {
  issuedCardInstanceReference: string;
  // The PSP's surrogate token, which is how a request arrives here without carrying a PAN.
  paymentCardReference: string;
  paymentCardInstanceReference: string;
  // Encrypted with an equality query type, so a card is locatable by exact number over ciphertext.
  paymentCardNumber: string;
  // Issuer datum feeding the verification value derivation.
  cardServiceCode: string;
  // A reference to the key, never the key: both would be defeated by sharing a record with the PAN.
  cardIssuerCvkKeyId?: string;
  issuedCardStatus: IssuedCardStatus;
  bianServiceDomain: string;
  bianControlRecordType: 'CardAdministration';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// The lifecycle and display data of every card issued here, with no PAN. Named apart from the PSP's own
// paymentCardRegistry deliberately: that one dedupes accepted card instruments for fraud signals, this one
// is the issuer's record of what it put in customers' hands.
export interface IssuedCardRegistryRecord {
  issuedCardRegistryInstanceReference: string;
  paymentCardReference: string;
  accountHolderInstanceReference?: string;
  // Funding account at this bank, which is what a card authorisation is held against.
  accountArrangementInstanceReference?: string;
  paymentCardNetwork: string;
  // Debit for every card this bank issues today. Read with a default rather than required, so a record
  // seeded before the field existed reads as what it is instead of as undefined.
  paymentCardKind?: IssuedCardKind;
  paymentCardBin: string;
  paymentCardLastFour: string;
  paymentCardMaskedDisplay: string;
  paymentCardExpiryMonth?: string;
  paymentCardExpiryYear?: string;
  issuedCardStatus: IssuedCardStatus;
  issuedCardLimits?: IssuedCardLimits;
  // Set on a replacement, pointing at the card it superseded, so a lost card's history stays followable.
  replacesPaymentCardReference?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'IssuedCardRegistry';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
