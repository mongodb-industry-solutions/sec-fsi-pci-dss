// BIAN SD-89: Merchant Relations Control Record

export const MERCHANT_AGREEMENT_COLLECTION = 'merchantAgreementProcedure';

export interface MerchantApiKeyRecord {
  keyId: string;            // UUID
  keyPrefix: string;        // First 8 chars for display: "lbpk_liv..."
  keyHashBcrypt: string;    // bcrypt(fullPlaintextKey, 12) - plaintext never stored
  keyStatus: 'active' | 'revoked';
  keyCreatedDateTime: Date;
  keyLastUsedDateTime?: Date;
}

export interface MerchantAgreementControlRecord {
  // Identifiers
  merchantAgreementInstanceReference: string;       // UUID, primary key
  merchantName: string;                             // "TechStore Online"
  merchantLegalEntityReference: string;             // Tax / company ID (plaintext)
  merchantCategoryCode: string;                     // MCC ISO 18245: 5732, 5411, etc.
  merchantCountryCode: string;                      // ISO 3166-1 alpha-2
  merchantAgreementStatus: MerchantAgreementStatus;
  merchantTier: 'standard' | 'enterprise';

  // D-21: Party owner link — BIAN-canonical cross-domain reference via SD-13 Party.
  merchantOwnerPartyReference?: string;             // FK → party.partyInstanceReference (SD-13)

  // Ch-05: Review metadata — populated by merchant_officer on approve/reject (BIAN Action: Control)
  merchantReviewNote?: string;
  merchantReviewedByPartyReference?: string;        // FK → party.partyInstanceReference of reviewing officer
  merchantReviewedDateTime?: Date;

  // Gateway configuration
  merchantAllowedCurrencies: string[];              // ISO 4217 codes
  merchantTransactionLimitAmount: number;           // Per-transaction limit (base currency)
  merchantWebhookEndpoint?: string;                 // Notification URL for payment events
  merchantWebhookSecret?: string;                   // HMAC-SHA256 signing secret for webhook delivery
  merchantSettlementSchedule: SettlementSchedule;

  // Risk profile (derived, updated on settlement)
  merchantAverageTransactionAmount: number;
  merchantTransactionCount30d: number;
  merchantRiskCategory: MerchantRiskCategory;

  // API key management (replaces single merchantApiKeyHash)
  merchantApiKeys: MerchantApiKeyRecord[];

  // BIAN metadata
  bianServiceDomain: 'Merchant Relations';
  bianControlRecordType: 'MerchantAgreementProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

// Ch-05: Full BIAN SD-89 Agreement lifecycle.
// Initiate (customer) → Control (merchant_officer approve/reject) → Update (amend) → Terminate (close)
export type MerchantAgreementStatus =
  | 'initiated'       // Application submitted; not yet in review
  | 'under_review'    // merchant_officer performing KYB check
  | 'agreed'          // KYB passed; officer approved (Control: approve)
  | 'active'          // T&C accepted; API keys usable; payments enabled
  | 'amended'         // Terms updated (Update)
  | 'suspended'       // Fraud hold or compliance flag
  | 'rejected'        // KYB failed or policy issue (Control: reject)
  | 'closed';         // Agreement terminated (Terminate)
export type MerchantRiskCategory = 'low' | 'medium' | 'high';
export type SettlementSchedule = 'T+1' | 'T+2' | 'T+3';
