// Merchant Relations Control Record

export const MERCHANT_AGREEMENT_COLLECTION = 'merchantAgreementProcedure';


// v16: Typed webhook registry (BQ:Notification, ADR-038)
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
  webhookApiKeyId?: string;                          // keyId ref → the apiKey collection; key prefix injected on delivery
  webhookApiKeyTransport?: 'header' | 'body';       // injection channel
  webhookApiKeyFieldName?: string;                   // header name or body field name (e.g. X-Api-Key)
  webhookCreatedDateTime: Date;
  webhookLastTestedAt?: Date;
  webhookLastDeliveryStatus?: 'success' | 'failed';
  webhookLastDeliveryError?: string;
}

// v31 (+): beneficial owner / shareholder / controlling person. FATF / 4th AMLD (UBO).
// Owners are Party roles referenced from the Merchant Agreement , consistent with the
// existing D-21 dual-role Party pattern. PII (name/DOB/address/govID) is NOT duplicated here: it lives
// in the referenced `party` record (QE-tiered, GDPR Art. 5 minimization). This embed carries only the
// FK + role + numeric ownership/control metadata. Bounded set (regulatory reporting caps it) → safe to
// embed (subset pattern), NOT an unbounded array. Reverse lookup "which merchants does this party own"
// is a multikey index match on merchantBeneficialOwnerPartyReference.
export type MerchantBeneficialOwnerRole =
  | 'ultimate_beneficial_owner'
  | 'director'
  | 'shareholder'
  | 'authorized_signatory';

export interface MerchantBeneficialOwner {
  merchantBeneficialOwnerPartyReference: string;        // FK → party.partyInstanceReference 
  merchantBeneficialOwnerRole: MerchantBeneficialOwnerRole;
  merchantBeneficialOwnerOwnershipPercentage: number;   // REQUIRED numeric participation, 0..100 (2 dp)
  merchantBeneficialOwnerIsPrimary: boolean;            // exactly one true = default/controlling owner
  merchantBeneficialOwnerIsControllingPerson: boolean;  // FATF control test (>25% or board control)
  merchantBeneficialOwnerAddedDateTime: Date;
  merchantBeneficialOwnerAddedByPartyReference?: string; // FK → party (officer who added)
}

// Hard cap: store only REPORTABLE beneficial owners (> threshold) + controllers, never the full cap
// table. Keeps the document far below 16 MB and the array bounded (anti-pattern guard, plan §10.2).
export const MERCHANT_BENEFICIAL_OWNERS_MAX = 25;

export interface MerchantAgreementControlRecord {
  // Identifiers
  merchantAgreementInstanceReference: string;       // UUID, primary key
  merchantName: string;                             // "TechStore Online"
  merchantLegalEntityReference: string;             // Tax / company ID (plaintext)
  merchantCategoryCode: string;                     // MCC ISO 18245: 5732, 5411, etc.
  merchantCountryCode: string;                      // ISO 3166-1 alpha-2
  merchantAgreementStatus: MerchantAgreementStatus;
  merchantTier: 'standard' | 'enterprise';

  // D-21: Party owner link, BIAN-canonical cross-domain reference via Party.
  // v31: kept and maintained as a DERIVED pointer to the primary/controlling owner (back-compat:
  // existing N:1 reverse-lookups, payout fallback, notification routing). Always equals the party ref
  // of the merchantBeneficialOwners element whose merchantBeneficialOwnerIsPrimary === true.
  merchantOwnerPartyReference?: string;             // FK → party.partyInstanceReference 

  // v31 (+ FATF/4th AMLD): beneficial owners / shareholders. 1..N; invariant: exactly one
  // isPrimary (= merchantOwnerPartyReference). Bounded embed (subset pattern). See MerchantBeneficialOwner.
  merchantBeneficialOwners?: MerchantBeneficialOwner[];

  // v17: Default settlement account . Used as payout destination for merchant settlements.
  // Resolution order: merchantDefaultPayoutAccountReference → owner's default payoutAccount → exception
  merchantDefaultPayoutAccountReference?: string;  // FK → payoutAccountArrangement 

  // Ch-05: Review metadata (top-level, kept for backward compat). Populated by merchant_officer.
  merchantReviewNote?: string;
  merchantReviewedByPartyReference?: string;        // FK → party.partyInstanceReference of reviewing officer
  merchantReviewedDateTime?: Date;

  // Ch-06: BQ:Step, KYB business verification (BQ:Step). PCI DSS.
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;

  // Gateway configuration
  merchantAllowedCurrencies: string[];              // ISO 4217 codes
  merchantTransactionLimitAmount: number;           // Per-transaction limit (base currency)
  merchantWebhookEndpoint?: string;                 // Legacy single webhook (backward compat only)
  merchantWebhookSecret?: string;                   // Legacy signing secret (backward compat only)
  merchantWebhooks?: MerchantWebhookConfig[];       // v16: typed per-event webhook registry (ADR-038)
  merchantSettlementSchedule: SettlementSchedule;

  // v18 (pricing): commission rate charged per operation, 0..1 (e.g. 0.025 = 2.5%). Editable from
  // merchant settings (RBAC merchants:manage). Seeder only sets an initial default. Used by computeFee.
  merchantCommissionRate?: number;

  // Risk profile (derived, updated on settlement)
  merchantAverageTransactionAmount: number;
  merchantTransactionCount30d: number;
  merchantRiskCategory: MerchantRiskCategory;



  // BIAN metadata
  bianServiceDomain: 'Merchant Relations';
  bianControlRecordType: 'MerchantAgreementProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

// Ch-05: Full Agreement lifecycle.
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
// BQ:Step, KYB business verification (BQ:Step). PCI DSS.
export type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

// v31: result vocabularies (NOT lifecycle statuses, ADR-009). Reused verbatim from the provider/HRP
// layer so internal and external screening speak the same language.
export type KybBusinessRiskLevel = 'low' | 'medium' | 'high';
export type KybScreeningResult = 'clear' | 'hit' | 'pending';

export interface MerchantAgreementKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: Date;
  merchantAgreementKybCheckReference?: string;       // trade register / AML screening reference
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;  // FK → party (reviewing officer)

  // v31 structured ENTITY-layer verdict (BQ:Step, plaintext, no CHD/QE). Mirrors the KYC v27
  // verdict so KYB administration can review structured data (AML defensibility). Produced by the KYB
  // screening chain (§5bis) via applyKybScreeningVerdict, never by manual entry. The OWNER-layer risk
  // is composed by reference from each UBO's customerAgreementKycCheck (no duplication onto the merchant).
  merchantAgreementKybCheckBusinessRiskLevel?: KybBusinessRiskLevel;
  merchantAgreementKybCheckSanctionsResult?: KybScreeningResult;
  merchantAgreementKybCheckAdverseMediaResult?: KybScreeningResult;
  merchantAgreementKybCheckScreeningProviderRef?: string;
}

export type MerchantRiskCategory = 'low' | 'medium' | 'high';
export type SettlementSchedule = 'T+1' | 'T+2' | 'T+3';

// The OAuth client registry and the API keys are collections of their own (v39 P2). They used to be
// a sub-document and an array inside this record, which coupled a credential the authorization
// server verifies on every token request to a commercial record the gateway module owns.
export type { OAuthGrantType, OAuthBackchannelDeliveryMode } from './oauthClient.model';
