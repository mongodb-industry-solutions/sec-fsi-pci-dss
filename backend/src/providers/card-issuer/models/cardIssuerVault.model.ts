// BIAN SD-88 Payment Card, Card Administration facet (issuer-issued device).
// Module-owned issuer vault (v30). This collection is the issuer Cardholder Data Environment (CDE):
// it holds the FULL PAN (CHD) and the card service code, which NEVER exist in the PSP core. The PSP
// core (paymentCardManagement) stays descoped: token surrogate + BIN + last4 only. Removing the
// built-in card-issuer module (or routing the capability to an external provider) means this vault
// is unused and no PAN is stored anywhere. The core reaches the vault ONLY through a port.
export const CARD_ISSUER_VAULT_COLLECTION = 'cardIssuerVault';

export interface CardIssuerVaultRecord {
  // Module key (issued device reference).
  issuedCardInstanceReference: string;
  // Join key to the core card-on-file (surrogate token), resolved via the Card Reference port.
  paymentCardReference: string;
  // Reference to the core arrangement (paymentCardManagement PK).
  paymentCardInstanceReference: string;
  // CHD: the full PAN. QE:equality (exact match / dedup over ciphertext). Never returned in listings.
  paymentCardNumber: string;
  // Issuer datum, input to the CVV derivation (with PAN/token + expiry + CVK). QE:equality.
  cardServiceCode: string;
  // Reference (not the key) to the CVK used for this device's CVV derivation.
  cardIssuerCvkKeyId?: string;
  issuedCardStatus: 'issued' | 'active' | 'suspended' | 'revoked';
  bianServiceDomain: 'Payment Card';
  bianControlRecordType: 'CardAdministration';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime?: Date;
  schemaVersion: number;
}
