// BIAN SD-57: Card Etoken — Token Vault Control Record

export const TOKEN_VAULT_COLLECTION = 'tokenVault';

export interface TokenVaultControlRecord {
  // Identifiers
  tokenVaultInstanceReference: string;              // UUID, primary key

  // Links
  customerAgreementInstanceReference: string;       // FK → customerAgreement (plaintext)
  linkedPaymentCardInstanceReference?: string;      // FK → paymentCard (plaintext)

  // Token fields
  tokenVaultCardToken: string;                      // Plaintext surrogate token (tok_<uuid>)
  tokenVaultNetworkToken?: string;                  // QE:none — card scheme network token (if applicable)
  tokenVaultMaskedPanDisplay: string;               // ****-****-****-XXXX (display only)
  tokenVaultCardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';

  // Lifecycle
  tokenVaultStatus: TokenVaultStatus;
  tokenVaultCreatedAt: Date;
  tokenVaultLastUsedAt?: Date;
  tokenVaultExpiresAt?: Date;

  // BIAN metadata
  bianServiceDomain: 'CardEtoken';
  bianControlRecordType: 'TokenVault';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type TokenVaultStatus = 'active' | 'suspended' | 'expired';
