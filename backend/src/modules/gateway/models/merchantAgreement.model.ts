// BIAN SD-89: Merchant Relations Control Record

export const MERCHANT_AGREEMENT_COLLECTION = 'merchantAgreementProcedure';

export interface MerchantApiKeyRecord {
  keyId: string;            // UUID
  keyPrefix: string;        // First 8 chars for display: "lbpk_liv..."
  keyHashBcrypt: string;    // bcrypt(fullPlaintextKey, 12) - plaintext never stored
  keyStatus: 'active' | 'revoked';
  keyCreatedDateTime: Date;
  keyLastUsedDateTime?: Date;
  keyLabel?: string;        // Human label to identify/differentiate keys (never a secret)
  // 'generated' = minted by the PSP; 'imported' = supplied by the merchant's own system. Display
  // only (helps recognise which keys originate elsewhere). Absent on legacy records = generated.
  keyOrigin?: 'generated' | 'imported';
}

// v16: Typed webhook registry (SD-89 BQ:Notification, ADR-038)
// Each event type gets a dedicated webhook config with its own URL, secret, and attribute mapping.
// ISO 20022 pacs.002 alignment for payment events; OIDC for OAuth events.
export type WebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'oauth.authorization_granted'
  | 'oauth.authorization_revoked'
  | 'user.notification'
  | 'dispute.opened'
  | 'kyb.status_changed';

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'payment.completed': 'Payment Completed',
  'payment.failed': 'Payment Failed',
  'oauth.authorization_granted': 'OAuth Authorization Granted',
  'oauth.authorization_revoked': 'OAuth Authorization Revoked',
  'user.notification': 'User Notification (delegation)',
  'dispute.opened': 'Dispute Opened',
  'kyb.status_changed': 'KYB Status Changed',
};

export interface MerchantWebhookConfig {
  webhookId: string;                              // UUID
  webhookEventType: WebhookEventType;             // One webhook config per event type
  webhookUrl: string;                             // HTTPS endpoint
  webhookSecret: string;                          // HMAC-SHA256 signing secret (stored; masked on GET)
  webhookStatus: 'active' | 'inactive';
  webhookAttributeMapping?: Record<string, string>; // PSP field name → merchant field name remapping
  webhookHeaders?: Record<string, string>;          // static HTTP headers sent with every delivery (e.g. Authorization)
  webhookApiKeyId?: string;                          // keyId ref → merchantApiKeys; key prefix injected on delivery
  webhookApiKeyTransport?: 'header' | 'body';       // injection channel
  webhookApiKeyFieldName?: string;                   // header name or body field name (e.g. X-Api-Key)
  webhookCreatedDateTime: Date;
  webhookLastTestedAt?: Date;
  webhookLastDeliveryStatus?: 'success' | 'failed';
  webhookLastDeliveryError?: string;
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

  // Ch-05: Review metadata (top-level — kept for backward compat). Populated by merchant_officer.
  merchantReviewNote?: string;
  merchantReviewedByPartyReference?: string;        // FK → party.partyInstanceReference of reviewing officer
  merchantReviewedDateTime?: Date;

  // Ch-06: BQ:Step — KYB business verification (BIAN SD-89 BQ:Step). PCI DSS Req 12.8.
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;

  // Gateway configuration
  merchantAllowedCurrencies: string[];              // ISO 4217 codes
  merchantTransactionLimitAmount: number;           // Per-transaction limit (base currency)
  merchantWebhookEndpoint?: string;                 // Legacy single webhook (backward compat only)
  merchantWebhookSecret?: string;                   // Legacy signing secret (backward compat only)
  merchantWebhooks?: MerchantWebhookConfig[];       // v16: typed per-event webhook registry (ADR-038)
  merchantSettlementSchedule: SettlementSchedule;

  // Risk profile (derived, updated on settlement)
  merchantAverageTransactionAmount: number;
  merchantTransactionCount30d: number;
  merchantRiskCategory: MerchantRiskCategory;

  // API key management (replaces single merchantApiKeyHash)
  merchantApiKeys: MerchantApiKeyRecord[];

  // v16: OAuth 2.0 client registration (SD-89 BQ:Grant — ADR-037)
  merchantOAuthClient?: MerchantOAuthClientConfig;

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
// BQ:Step — KYB business verification (BIAN SD-89 BQ:Step). PCI DSS Req 12.8.
export type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

export interface MerchantAgreementKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: Date;
  merchantAgreementKybCheckReference?: string;       // trade register / AML screening reference
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;  // FK → party (reviewing officer)
}

export type MerchantRiskCategory = 'low' | 'medium' | 'high';
export type SettlementSchedule = 'T+1' | 'T+2' | 'T+3';

// v16: OAuth 2.0 client config (BIAN SD-89 BQ:Grant — OAuth Client Authorization, ADR-037)
export type OAuthGrantType = 'authorization_code' | 'client_credentials' | 'refresh_token';

export interface MerchantOAuthClientConfig {
  oauthClientId: string;                          // UUID, assigned by PSP
  oauthClientSecretHash: string;                  // bcrypt(12); plaintext shown once, never stored
  oauthClientSecretPrefix: string;                // First 8 chars for display
  oauthRedirectUris: string[];                    // Allowed redirect_uri values
  oauthGrantTypes: OAuthGrantType[];              // Permitted grant types
  oauthScopes: string[];                          // Scopes this client is allowed to request
  oauthClientStatus: 'active' | 'suspended' | 'revoked';
  oauthClientCreatedDateTime: Date;
  oauthTokenLifetimeSeconds: number;              // Default: 3600
  oauthRefreshTokenLifetimeDays: number;          // Default: 30
  oauthRequirePkce: boolean;                      // true for public clients (authorization_code)
}
