// The issuer's card vault: the ONLY place a full PAN exists on this platform.
//
// It lives here because PCI DSS assigns scope to whoever stores, processes or transmits a PAN, and that is
// the institution that ISSUED the card. The PSP's card-on-file store keeps a surrogate token, a masked
// display PAN and a BIN plus last four, which is what lets it operate without ever holding cardholder data.
//
// Two tokenisations exist on this platform and neither replaces the other: this one, the issuer's, and the
// PSP's acceptance-side token vault. That mirrors the EMVCo split between acceptance tokens and
// issuer/network tokens.
export const CARD_ISSUER_VAULT_COLLECTION = 'cardIssuerVault';
export const PAYMENT_CARD_REGISTRY_COLLECTION = 'paymentCardRegistry';

export type IssuedCardStatus = 'issued' | 'active' | 'suspended' | 'revoked';

export interface CardIssuerVaultRecord {
  issuedCardInstanceReference: string;
  // The PSP's surrogate token, which is how a request arrives here without carrying a PAN.
  paymentCardReference: string;
  // The PSP's own card-on-file record, kept so the two sides resolve to each other.
  paymentCardInstanceReference: string;
  // CHD: the full PAN, encrypted with an equality query type so a card can be located or de-duplicated by
  // its exact number over ciphertext, with no client-side decryption. That is the whole point of holding it
  // this way rather than as an opaque blob.
  paymentCardNumber: string;
  // Issuer datum feeding the CVV derivation, alongside the PAN, the expiry and the card verification key.
  cardServiceCode: string;
  // A REFERENCE to the key, never the key: a CVK in the same record as the PAN would defeat both.
  cardIssuerCvkKeyId?: string;
  issuedCardStatus: IssuedCardStatus;
  bianServiceDomain: string;
  bianControlRecordType: 'CardAdministration';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// The issuer's own registry of the cards it has issued: the lifecycle and the display data, with no PAN.
// Separate from the vault deliberately, so reading "what cards does this holder have" never touches the
// collection that holds cardholder data.
export interface PaymentCardRegistryRecord {
  paymentCardRegistryInstanceReference: string;
  paymentCardReference: string;
  accountHolderInstanceReference?: string;
  // Funding account at this bank, which is what a card authorisation is held against.
  accountArrangementInstanceReference?: string;
  paymentCardNetwork: string;
  paymentCardBin: string;
  paymentCardLastFour: string;
  paymentCardMaskedDisplay: string;
  paymentCardExpiryMonth?: string;
  paymentCardExpiryYear?: string;
  issuedCardStatus: IssuedCardStatus;
  bianServiceDomain: string;
  bianControlRecordType: 'PaymentCardRegistry';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
