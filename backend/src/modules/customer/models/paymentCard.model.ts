// BIAN SD-88: Payment Card
// CR: PaymentCardManagement

export const PAYMENT_CARD_COLLECTION = 'paymentCardManagement';

export interface PaymentCardManagementControlRecord {
  paymentCardInstanceReference: string;
  customerAgreementInstanceReference: string;
  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;
  // QE none: non-searchable, retrieval only. Optional: a card auto-registered from an external
  // payment may not carry the expiry; the customer can add it later. Never holds a CVV.
  paymentCardExpirationDate?: string;
  // v30 non-CHD truncated PAN: BIN (first 6, PCI permits <=8) + last 4. These are the SOURCE OF
  // TRUTH for display; the masked PAN is DERIVED from them (see deriveMaskedPan). Indexed for
  // BIN-prefix + last4 search. The core stays descoped: the full PAN lives only in the issuer vault.
  paymentCardBin?: string;
  paymentCardLast4?: string;
  // Deprecated persisted field (v30): no longer written. Kept optional for back-compat with records
  // not yet reseeded; the API returns the masked PAN computed on the fly via deriveMaskedPan().
  paymentCardMaskedPanDisplay?: string;
  // Optional: not every payment source reports the scheme (e.g. token-only external integrations).
  paymentCardNetwork?: CardNetwork;
  paymentCardStatus: CardStatus;
  paymentCardIssuanceDateTime: Date;
  paymentCardIsPreferred: boolean;
  // Customer-defined, NON-CHD descriptive metadata (the only customer-editable attributes).
  // PCI DSS: these are free-text display labels only — they MUST NOT contain a PAN/CVV; the UI
  // and API treat them as a nickname/memo so the cardholder can recognize a card-on-file.
  // BIAN SD-88: customer-facing presentation attributes of the PaymentCardManagement control record.
  paymentCardAlias?: string;
  paymentCardCustomerNote?: string;
  // v4: recurring payment mandate
  paymentCardMandateStatus?: 'active' | 'cancelled' | 'expired';
  paymentCardConsentDateTime?: Date;
  paymentCardMandateExpiryDate?: Date;
  // BIAN SD-88 cardAccountReference: references the SD-66 PayoutAccountArrangement that funds this
  // card. UUID only — IBAN never stored here (PCI DSS Req 3.3). Optional: null = card not yet linked.
  fundingPayoutAccountInstanceReference?: string;
  bianServiceDomain: 'Payment Card';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime?: Date;
  schemaVersion: number;
}

// Derive the display-safe masked PAN from the non-CHD truncated parts. Prefers a persisted masked
// value when present (legacy records / immutable ledger snapshots), otherwise builds it from
// BIN + last4. Never touches CHD. Format: ****-****-****-1234 (or a BIN-prefixed form when known).
export function deriveMaskedPan(card: {
  paymentCardMaskedPanDisplay?: string;
  paymentCardBin?: string;
  paymentCardLast4?: string;
}): string {
  if (card.paymentCardMaskedPanDisplay) return card.paymentCardMaskedPanDisplay;
  const last4 = (card.paymentCardLast4 ?? '').replace(/\D/g, '').slice(-4);
  const bin = (card.paymentCardBin ?? '').replace(/\D/g, '').slice(0, 6);
  if (!last4) return '';
  if (bin.length >= 6) return `${bin.slice(0, 4)}-${bin.slice(4)}**-****-${last4}`;
  return `****-****-****-${last4}`;
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type CardStatus =
  | 'issued'
  | 'active'
  | 'pending_activation'
  | 'blocked'
  | 'suspended'
  | 'revoked'
  | 'expired';
