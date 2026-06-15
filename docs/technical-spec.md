# Technical Specification

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-06-13

This document covers the implementation-level detail that the PRD deliberately omits: BIAN TypeScript interfaces, QE `encryptedFieldsMaps`, API contracts, index creation, and environment configuration. Engineers start here.

---

## Table of Contents

1. [BIAN TypeScript Models](#1-bian-typescript-models)
2. [QE encryptedFieldsMaps](#2-qe-encryptedfieldsmaps)
3. [Key Management Setup](#3-key-management-setup)
4. [MongoDB Client Initialization](#4-mongodb-client-initialization)
5. [Index Creation](#5-index-creation)
6. [API Contracts](#6-api-contracts)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Seed Data Schema](#8-seed-data-schema)
9. [Backend Source Structure](#9-backend-source-structure)

---

## 1. BIAN TypeScript Models

All models live in `backend/src/modules/*/models/`. Each file exports the TypeScript interface for the collection document and the collection name constant. All collections follow strict BIAN Service Domain (SD) naming.

### `party.model.ts` (SD-13 — new)

```typescript
// BIAN SD-13: Party Data Management
// Canonical PII store. All other SDs reference parties via partyInstanceReference (FK).

export const PARTY_COLLECTION = 'party';

export interface PartyControlRecord {
  partyInstanceReference: string;        // PK, UUID; referenced as FK by SD-53, SD-91
  partyEmailAddress: string;             // QE:equality — primary investigation search key
  partyMobilePhoneNumber: string;        // QE:equality — secondary investigation search key
  partyName: string;                     // Becomes QE:equality in v2
  partyType: PartyType;
  partyDateOfBirth?: string;             // ISO 8601 date
  partyNationality?: string;             // ISO 3166-1 alpha-2
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'Party';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type PartyType = 'customer' | 'employee' | 'service_account';
```

### `customerAuthentication.model.ts` (SD-91 — new)

```typescript
// BIAN SD-91: Customer Authentication
// Owns login credentials, roles, and account access state.
// Linked to party (SD-13) via partyInstanceReference.

export const CUSTOMER_AUTHENTICATION_COLLECTION = 'customerAuthenticationAssessment';

export interface CustomerAuthenticationAssessmentRecord {
  customerAuthenticationInstanceReference: string;    // PK, UUID; used as JWT sub
  partyInstanceReference: string;                     // FK to party (SD-13)
  customerAuthenticationEmailAddress: string;         // QE:equality — login lookup
  customerAuthenticationCredentialHash: string;       // bcrypt 12-round; NOT QE (hash is not PII)
  customerAuthenticationUserRole: CustomerAuthRole;
  customerAuthenticationUserName: string;             // Denormalized from party for JWT name claim
  customerAuthenticationLoginDomain: 'local' | 'msentra';
  customerAuthenticationAccountStatus: 'active' | 'suspended';
  customerAuthenticationLastLoginDateTime?: Date;
  bianServiceDomain: 'Customer Authentication';
  bianControlRecordType: 'CustomerAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type CustomerAuthRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer';   // SD-89 Merchant Relations — Merchant Acquiring bank employee
```

### `customerAgreement.model.ts` (SD-53 — v3 updated)

> **v2 change**: `customerAgreementProcedureSensitive` collection removed. Sensitive QE:none fields are now **inline** in `customerAgreementProcedure`. The QE tier (Level 1 / Level 2 client) controls whether they are returned as Binary or decrypted.
>
> **v3 change (Ch-06)**: Added `customerAgreementKycCheck` as a **BIAN BQ:Step** sub-document (SD-53 Behavior Qualifier type Step). This is the formal KYC identity-verification record for the onboarding lifecycle. PCI DSS Req 8.1. All fields use the BIAN-canonical BQ naming prefix `customerAgreementKycCheck*`. `schemaVersion` bumped to 3.

```typescript
// BIAN SD-53: Customer Agreement
// Business contract: account reference, segment, status, and sensitive PII (inline, QE:none).
// PII (email, phone, name) separated to party (SD-13).

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreementProcedure';
// CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION removed in v2

// BQ:Step — KYC identity verification (BIAN SD-53 Behavior Qualifier type Step).
// Status vocabulary follows BIAN lifecycle: initiated | verified | rejected | expired.
// PCI DSS Req 8.1 — unique user identity verification at onboarding.
export type KycCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

export interface CustomerAgreementKycCheck {
  customerAgreementKycCheckStatus: KycCheckStatus;
  customerAgreementKycCheckCompletedDate?: Date;
  customerAgreementKycCheckReference?: string;  // External AML/ID verification reference
  customerAgreementKycCheckNotes?: string;
}

export interface CustomerAgreementControlRecord {
  customerAgreementInstanceReference: string;         // PK, UUID
  partyInstanceReference: string;                     // FK to party (SD-13)

  // QE:equality — direct search key
  customerAgreementReference: string;

  // QE:none (DEK-sensitive tier) — returned as Binary by L1 client; decrypted by L2
  customerAgreementResidentialAddress?: ResidentialAddress;
  governmentIdentificationReference?: string;
  customerAgreementRiskNotes?: string;

  // Plaintext operational fields
  customerSegment: CustomerSegment;
  customerAgreementStatus: AgreementStatus;
  customerAgreementEnrollmentDate: Date;
  customerAgreementPreferredLanguage: string;          // ISO 639-1
  customerAgreementPreferredPaymentCardReference?: string; // FK to paymentCardManagement UUID

  // Ch-06: BQ:Step — KYC identity check (BIAN SD-53). PCI DSS Req 8.1.
  customerAgreementKycCheck?: CustomerAgreementKycCheck;

  bianServiceDomain: 'Customer Agreement';
  bianControlRecordType: 'CustomerAgreementProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                              // Current: 3
}

// Binary field detection helper: returns false if field is BSON Binary (not decrypted by L1 client)
export function isSensitiveDecrypted(field: unknown): boolean {
  if (field === undefined || field === null) return false;
  if (typeof field === 'object' && field !== null &&
      'sub_type' in field && 'buffer' in field) return false;
  return true;
}

export interface ResidentialAddress {
  streetAddress: string;
  city: string;
  postalCode: string;
  countryCode: string;                                // ISO 3166-1 alpha-2
}

export type CustomerSegment = 'retail' | 'premium' | 'corporate' | 'sme';
export type AgreementStatus =
  | 'initiated'
  | 'agreed'
  | 'active'
  | 'amended'
  | 'suspended'
  | 'dormant'
  | 'closed';
```

### `paymentCard.model.ts` (SD-88 — updated)

```typescript
// BIAN SD-88: Payment Card

export const PAYMENT_CARD_COLLECTION = 'paymentCardManagement';

export interface PaymentCardManagementControlRecord {
  paymentCardInstanceReference: string;               // PK, UUID
  customerAgreementInstanceReference: string;         // FK to customerAgreementProcedure

  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;                       // Indexed plaintext; standard query, not QE
  paymentCardExpirationDate: string;                  // QE:none (MM/YY, CHD co-located with card ref)
  paymentCardMaskedPanDisplay: string;                // ****-****-****-1234
  paymentCardNetwork: CardNetwork;
  paymentCardStatus: PaymentCardStatus;
  paymentCardIssuanceDateTime: Date;
  paymentCardIsPreferred: boolean;

  // v4: recurring payment mandate (PCI DSS Req 3.1 + 3.7)
  paymentCardMandateStatus?: 'active' | 'cancelled' | 'expired';
  paymentCardConsentDateTime?: Date;
  paymentCardMandateExpiryDate?: Date;

  // BIAN metadata
  bianServiceDomain: 'Payment Card';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type PaymentCardStatus =
  | 'issued'
  | 'active'
  | 'pending_activation'
  | 'blocked'
  | 'suspended'
  | 'revoked'
  | 'expired';
```

### `cardTransaction.model.ts` (SD-254 — v2 updated)

> **v2 change**: `cardTransactionLogSensitive` collection removed. Sensitive QE:none fields are now **inline** in `cardTransactionLog`. The QE tier controls whether they are returned as Binary or decrypted.

```typescript
// BIAN SD-254: Card Transaction

export const CARD_TRANSACTION_COLLECTION = 'cardTransactionLog';
// CARD_TRANSACTION_SENSITIVE_COLLECTION removed in v2

export interface CardTransactionLogControlRecord {
  cardTransactionInstanceReference: string;           // PK, UUID
  paymentCardReference: string;                       // Indexed plaintext (surrogate, not CHD)
  cardTransactionAccountReference: string;            // QE:equality — investigator search key

  // QE:none (DEK-sensitive tier) — returned as Binary by L1 client; decrypted by L2
  rawGatewayPayload?: object;
  processorTransactionMetadata?: object;

  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: Date;
  cardTransactionStatus: CardTransactionStatus;
  cardTransactionType: CardTransactionType;           // BIAN SD-254 classification
  cardTransactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;

  // BIAN SD-254 statement descriptor fields (plaintext, not CHD, no QE)
  cardTransactionDescription: string;                 // Max 22 chars; visible on cardholder statement
  cardTransactionNarrative?: string;                  // Extended context for fraud investigation

  bianServiceDomain: 'Card Transaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                              // Current: 3
}

export type CardTransactionStatus =
  'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
export type CardTransactionType =
  'purchase' | 'cash_advance' | 'balance_transfer' | 'refund' | 'fee' | 'adjustment';
export type CardTransactionChannel =
  'online' | 'pos' | 'contactless' | 'atm';
export type CardTransactionInitiationType = 'customerInitiated' | 'merchantInitiated';
```

### `fraudDiagnosis.model.ts`

```typescript
// BIAN SD-83: Fraud Diagnosis (no QE: operational metadata only)

export const FRAUD_DIAGNOSIS_COLLECTION = 'fraudDiagnosisCase';
export const FRAUD_DIAGNOSIS_EVENTS_COLLECTION = 'fraudDiagnosisCaseEvents';

export interface FraudDiagnosisControlRecord {
  // Identifiers
  fraudDiagnosisInstanceReference: string;               // UUID, primary key
  fraudDiagnosisCaseReference: string;                   // FD-2026-001234

  // Links to protected records — BIAN *InstanceReference FK naming pattern
  cardTransactionInstanceReference: string;              // FK to cardTransactionLog (SD-254)
  customerAgreementInstanceReference: string;            // FK to customerAgreementProcedure (SD-53)

  // Extended Reference Pattern: stable display fields from cardTransaction.
  // Embedded to make fraud investigation display a single-collection query.
  // Updated only when transaction status changes (controlled write path).
  transactionSnapshot: {
    cardTransactionAmount: { amount: number; currency: string };
    cardTransactionMerchantName: string;
    cardTransactionDateTime: Date;
    cardTransactionStatus: 'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
    cardTransactionMaskedPanDisplay: string;
  };

  // Case lifecycle
  fraudDiagnosisCaseStatus: FraudDiagnosisCaseStatus;
  fraudDiagnosisCaseSeverity: RiskSeverity;
  fraudDiagnosisRequestDateTime: Date;
  fraudDiagnosisCaseClosingDateTime?: Date;

  // Assignment (v2: populated when case is assigned)
  fraudDiagnosisAnalystInstanceReference?: string;       // FK to customerAuthenticationAssessment (L1)
  fraudDiagnosisInvestigatorInstanceReference?: string;  // FK to customerAuthenticationAssessment (L2)

  // Assessment
  fraudDiagnosisAssessment: {
    riskIndicators: string[];                            // e.g. ["amount_threshold", "high_risk_mcc"]
    fraudDiagnosisScore?: number;                        // 0-100
    fraudDiagnosisConclusion?: string;
  };

  // Escalation record (populated when status becomes escalated)
  fraudDiagnosisEscalationRecord?: {
    escalationDateTime: Date;
    escalationReason: string;
    escalatedByInstanceReference: string;
    escalatedToInstanceReference: string;
  };

  // Resolution record (populated on close)
  fraudDiagnosisResolutionRecord?: {
    resolutionDateTime: Date;
    resolutionOutcome: ResolutionOutcome;
    resolutionNotes: string;
    resolvedByInstanceReference: string;
  };

  // AI agent draft (v5: populated by agent, absent if agent disabled)
  agentDraftDiagnosis?: {
    riskSummary: string;
    recommendedAction: 'clear' | 'escalate' | 'investigate';
    confidenceScore: number;                             // 0-100
    supportingEvidence: string[];
    agentCompletionDateTime: Date;
  };

  // BIAN metadata
  bianServiceDomain: 'Fraud Diagnosis';
  bianControlRecordType: 'FraudDiagnosis';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;

  // Schema Versioning Pattern: enables zero-downtime schema evolution across v1-v5
  schemaVersion: number;
}

// Audit event document stored in fraudDiagnosisCaseEvents (separate collection).
// Replaces the embedded diagnosisActionLog array (Unbounded Array anti-pattern fix).
// Indexed on (fraudDiagnosisInstanceReference, actionDateTime) for ordered retrieval.
export interface FraudDiagnosisCaseEventRecord {
  fraudDiagnosisInstanceReference: string;               // FK to fraudDiagnosisCase
  actionDateTime: Date;
  actionType: ActionType;
  performedByInstanceReference: string;
  performedByRole: AnalystRole;
  actionDetails: Record<string, unknown>;
  schemaVersion: number;
}

export type FraudDiagnosisCaseStatus =
  | 'open'
  | 'under_review'
  | 'escalated'
  | 'resolved_cleared'
  | 'resolved_fraud'
  | 'closed';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnalystRole =
  | 'payment_service'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'ai_agent';

export type ActionType =
  | 'case_opened'
  | 'assigned'
  | 'note_added'
  | 'note_retracted'
  | 'field_accessed'
  | 'escalated'
  | 'ai_review'
  | 'resolved'
  | 'closed';

export type ResolutionOutcome = 'cleared' | 'confirmed_fraud' | 'referred';
```

**Collection:** `fraudDiagnosisCaseEvents` (SD-83) — append-only audit and notes log. Every case event (including notes) is stored here. Indexed on `(fraudDiagnosisInstanceReference, actionDateTime)` for ordered retrieval. See §5 for index definitions.

Document shape:

| Field | Type | Notes |
|---|---|---|
| `fraudDiagnosisInstanceReference` | `string` | FK to `fraudDiagnosisCase` |
| `actionDateTime` | `Date` | Event timestamp |
| `actionType` | `ActionType` | Includes `note_added`, `note_retracted` |
| `performedByRole` | `AnalystRole` | Role of the acting user |
| `actionDetails` | `Record<string, unknown>` | Shape varies by `actionType` |
| `schemaVersion` | `number` | Schema version |

**`NoteEntry` — API response shape for note records (used by note endpoints in §6.4):**

```typescript
export interface NoteEntry {
  noteId: string;
  noteText: string;
  visibility: 'internal' | 'customer';
  performedByRole: string;
  actionDateTime: string;           // ISO 8601
  isRetracted: boolean;
  retractionReason: string | null;
  retractionDateTime: string | null;
}
```

`noteId` is the `_id` of the `note_added` event in `fraudDiagnosisCaseEvents`. Retracted notes remain in the collection (BIAN SD-83 append-only); a `note_retracted` event is appended referencing the original `noteId`.

---

### `partyAuthentication.model.ts` (SD-16 — updated)

```typescript
// BIAN SD-16: Party Authentication
// Identity verification events only. Credentials and roles live in SD-91 (customerAuthenticationAssessment).

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthenticationAssessment';

export interface PartyAuthenticationAssessmentRecord {
  partyAuthenticationInstanceReference: string;           // PK, UUID
  partyInstanceReference: string;                         // FK to party (SD-13)
  partyAuthenticationLoginDomain: 'local' | 'msentra';
  partyAuthenticationAccountStatus: 'active' | 'suspended';
  bianServiceDomain: 'Party Authentication';
  bianControlRecordType: 'PartyAuthenticationAssessment';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
```

> **Auth credentials live in SD-91.** `customerAuthenticationAssessment` owns bcrypt hashes, roles, and login state. SD-16 (`partyAuthenticationAssessment`) is reserved for formal identity verification events (document scan, OTP, biometric) — v4+ scope.

### `authenticationDomain.model.ts`

```typescript
// BIAN SD-16: Party Authentication — Authentication Domain configuration registry

export const AUTHENTICATION_DOMAIN_COLLECTION = 'authenticationDomain';

export type AuthDomainType = 'local' | 'oidc' | 'saml';
export type AuthDomainName = 'local' | 'msentra' | 'bigid';

export interface AuthenticationDomainRecord {
  partyAuthenticationDomainInstanceReference: string;  // UUID, primary key
  partyAuthenticationDomainName: AuthDomainName;       // Slug used in login + JWT claim
  partyAuthenticationDomainDisplayName: string;        // UI label (e.g. "Microsoft Entra ID")
  partyAuthenticationDomainType: AuthDomainType;       // Protocol: local | oidc | saml
  partyAuthenticationDomainEnabled: boolean;           // Only enabled domains appear in UI
  partyAuthenticationDomainConfiguration: Record<string, unknown>; // Provider-specific config
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationDomain';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
```

**Collection:** `authenticationDomain` — plaintext, no QE (domain config contains no CHD or PII).
**Seed file:** `backend/data/authDomains.json` — 3 pre-seeded domains: `local` (enabled), `msentra` (disabled), `bigid` (disabled).
**API:** `GET /api/v1/auth/domains` (public) — returns only domains with `partyAuthenticationDomainEnabled: true`.

---

### `creditRating.model.ts`

```typescript
// BIAN SD-60: Customer Credit Rating — HRPC risk classification state per customer account

export const CUSTOMER_CREDIT_RATING_COLLECTION = 'customerCreditRatingState';

export type HrpcCategory =
  | 'pep'
  | 'sip'
  | 'hnwi'
  | 'ubo'
  | 'terrorism_linked'
  | 'high_risk_jurisdiction'
  | 'sanctioned'
  | 'financial_fraud_history'
  | 'suspicious_transaction_patterns';

export type HrpcRiskLevel = 'low' | 'medium' | 'high';

export type HrpcClassificationSource =
  | 'kyc_periodic_review'
  | 'transaction_monitoring'
  | 'correspondent_screening'
  | 'aml_due_diligence'
  | 'internal_case_history';

export interface CustomerCreditRatingClassificationFlag {
  customerCreditRatingClassificationCategory: HrpcCategory;
  customerCreditRatingClassificationLevel: HrpcRiskLevel;
  customerCreditRatingClassificationLabel: string;           // Human-readable label for UI
  customerCreditRatingClassificationDescription: string;     // Narrative explanation
  customerCreditRatingClassificationDetectedDateTime: string; // ISO 8601 date
  customerCreditRatingClassificationSource: HrpcClassificationSource;
  customerCreditRatingReviewRequiredIndicator: boolean;
}

export interface CustomerCreditRatingStateControlRecord {
  customerCreditRatingInstanceReference: string;             // UUID, primary key
  customerAgreementReference: string;                        // FK to customerAgreement (by account ref, not UUID)
  customerCreditRatingClassificationFlags: CustomerCreditRatingClassificationFlag[];
  bianServiceDomain: 'Customer Credit Rating';
  bianControlRecordType: 'CustomerCreditRatingState';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
```

**Collection:** `customerCreditRatingState` — plaintext, no QE. Contains compliance classification metadata only; no PII, no CHD.
**Seed file:** `backend/data/customerCreditRatings.json` — 5 pre-seeded HRPC profiles covering accounts ACC-003, ACC-007, ACC-012, ACC-019, ACC-025.
**API:** `GET /api/v1/fraud/hrpc/check?accountRef=<ref>` — see §6.6.
**Link key:** `customerAgreementReference` (a QE:equality field in `customerAgreementProcedure`) is used as the join key. The API looks up the fraud case's `customerAgreementInstanceReference`, resolves the account reference, then queries this collection. This avoids a cross-QE-collection `$lookup` (per ADR-001).

---

### 1.13 SD-193 — `externalProviderArrangement` (ExternalProviderArrangement)

> **Schema v2** — Updated 2026-06-11. Adds `generic` type, enhanced config sub-documents, multi-provider routing, and default routing groups.
> **dev.v7 Fase 2 (2026-06-14)** — Collections renamed to pure BIAN SD-193 control-record names; added `capabilityModuleConfiguration` (internal Module engine config, ADR-029). Constant identifiers keep `INTEGRATION_*` until the module rename (Fase 3).

```typescript
export const INTEGRATION_REGISTRY_COLLECTION       = 'externalProviderArrangement';
export const INTEGRATION_EVENTS_COLLECTION         = 'externalProviderArrangementActionLog';
export const INTEGRATION_ROUTING_GROUPS_COLLECTION = 'externalProviderArrangementPortfolio';
export const CAPABILITY_MODULE_CONFIGURATION_COLLECTION = 'capabilityModuleConfiguration';

export type IntegrationProviderType =
  | 'fraud_detection'
  | 'aml_monitoring'
  | 'kyc_identity'
  | 'kyb_business'
  | 'hrp_sanctions'
  | 'credit_bureau'
  | 'card_authorization'     // SD-254 Card Transaction Authorization
  | 'card_issuer'            // SD-88 Payment Card Issuer
  | 'generic';               // SD-193 catch-all for custom event-driven integrations

export type IntegrationStatus  = 'active' | 'inactive' | 'test' | 'suspended';
export type IntegrationMode    = 'sync' | 'async';
export type IntegrationAuth    = 'bearer' | 'api_key' | 'hmac' | 'oauth2_cc';
export type IntegrationHealth  = 'ok' | 'degraded' | 'unreachable' | 'unknown';
export type RoutingStrategy    = 'primary_fallback' | 'round_robin' | 'weighted' | 'parallel';

export interface ExternalProviderArrangement {
  externalProviderArrangementInstanceReference: string;    // UUID, primary key
  externalProviderArrangementName: string;
  externalProviderArrangementType: IntegrationProviderType;
  externalProviderArrangementStatus: IntegrationStatus;

  // Internal provider flag — pre-seeded, cannot be deleted or suspended
  externalProviderIsInternal: boolean;
  externalProviderInternalHandler?: string;               // e.g. "fraudDiagnosis.internalFraudScoring"

  // Outbound REST (external providers only)
  externalProviderApiEndpoint?: string;
  externalProviderApiKeyHash?: string;                    // bcrypt — NEVER returned in API responses
  externalProviderApiKeyPrefix?: string;                  // visible prefix for UI (e.g. "fds_live_...")
  externalProviderAuthScheme?: IntegrationAuth;

  // Inbound callback config (async providers)
  externalProviderCallbackEnabled: boolean;
  externalProviderCallbackPath?: string;                  // /webhooks/{type}/{arrangementId}/callback
  externalProviderCallbackSecretHash?: string;            // bcrypt — never returned

  // Event routing
  externalProviderTriggerEvents: string[];                // ['transaction.authorized', 'kyc.initiated']
  externalProviderMode: IntegrationMode;

  // Reliability
  externalProviderTimeoutMs: number;                      // 100–30000 ms
  externalProviderRetryPolicy: { maxAttempts: number; backoffMs: number };

  // Health
  externalProviderLastHealthCheckAt?: Date;
  externalProviderHealthStatus?: IntegrationHealth;

  // v2: Category-specific operational config (discriminated by type)
  categoryConfig?: CategoryConfig;

  // v2: Structured authentication config
  authConfig?: IntegrationAuthConfig;

  // v2: Field mapping — outbound (pre-dispatch) and inbound (post-callback)
  fieldMappingConfig?: FieldMappingConfig;

  // v2: Multi-provider routing — auto-set on creation to default group of the type
  routingGroupId?: string;                                // FK to integrationRoutingGroups
  routingPriority?: number;                               // lower = higher priority; internals use 999
  routingWeight?: number;                                 // 0–100 for weighted strategy

  // BIAN + PCI DSS metadata
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];

  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                                  // current: 2
}

// ── Routing Groups ──────────────────────────────────────────────────────────
// One default group per IntegrationProviderType is seeded automatically.
// External providers auto-join their type's default group on creation.
// Internal providers are members at priority=999 as fallback terminals.

export interface RoutingGroupMember {
  externalProviderArrangementInstanceReference: string;
  memberPriority: number;                                 // lower = tried first
  memberWeight?: number;                                  // 0–100 for weighted strategy
  memberRole?: 'primary' | 'fallback' | 'peer';
}

export interface IntegrationRoutingGroup {
  routingGroupInstanceReference: string;                  // UUID, primary key
  routingGroupName: string;
  routingGroupProviderType: IntegrationProviderType;      // all members must be this type
  routingGroupStrategy: RoutingStrategy;
  routingGroupStatus: 'active' | 'inactive';
  routingGroupMembers: RoutingGroupMember[];
  isDefaultGroup: boolean;                                // true = system-managed, one per type
  bianServiceDomain: string;
  bianControlRecordType: string;                          // 'ExternalProviderArrangementPortfolio'
  pciDssRequirements: string[];
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

// ── Business Context Correlation ────────────────────────────────────────────
// ADR-025: Added to IntegrationEvent to enable cross-entity audit queries.

export interface BusinessContextRef {
  entityType: 'transaction' | 'fraud_case' | 'customer' | 'merchant' | 'payment_link' | 'card';
  entityId: string;                                       // PK of the business entity
  processType: BusinessProcessType | ComplianceProcessType;
}

// ── Event Audit Log ─────────────────────────────────────────────────────────
// ADR-025: integrationEvents is a timeseries collection (timeField: recordCreatedDateTime).
// Unique secondary index removed — incompatible with MongoDB timeseries.

export interface IntegrationEvent {
  integrationEventInstanceReference: string;              // UUID
  externalProviderArrangementInstanceReference: string;   // FK to integrationRegistry
  integrationEventType: 'dispatch' | 'callback' | 'health_check' | 'test';
  integrationEventStatus: 'sent' | 'received' | 'error' | 'timeout';
  integrationEventPayloadHash?: string;                   // sha256 of payload — never the payload itself
  integrationEventResponseCode?: number;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  integrationEventTriggeredBy: string;
  integrationEventMeta?: Record<string, unknown>;         // fieldMappingApplied, mappingRulesCount, etc.
  businessContext?: BusinessContextRef;                   // ADR-025: correlation to originating entity
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date;
}
```

**Collections:**
- `integrationRegistry` — plaintext, no QE. Provider configuration, key hashes, health state.
- `integrationRoutingGroups` — plaintext, no QE. One default group per type + user-created groups.
- `integrationEvents` — **timeseries** (ADR-025), no QE. Append-only audit log; timeField=`recordCreatedDateTime`, TTL 90 days.

**Seed files:**
- `backend/data/integrationRegistry.json` — 6 pre-seeded internal providers (FDS, HRP, AML, KYC, KYB, CreditBureau) at `routingPriority=999`.
- Default routing groups seeded programmatically by `seedRoutingGroups.ts` (called from `seedIntegrations`).

**Default group invariant:**
- Exactly one `isDefaultGroup=true` document per `IntegrationProviderType` (7 total).
- Each internal provider is a group member at `memberPriority=999`, `memberRole='fallback'`.
- External providers auto-join on creation: `memberPriority = max(external priorities) + 10`, minimum 10.

**Security notes:**
- `externalProviderApiKeyHash` and `externalProviderCallbackSecretHash` are bcrypt hashes — never returned in API responses.
- Plaintext API key returned exactly once at creation and once at rotation.
- Payload content is never logged; only a SHA-256 hash is stored for audit reference.
- Field mapping engine enforces a PCI DSS blocklist: PAN, CVV, expiryDate, cardholderName cannot be mapped.

---

### 1.14 Business Process Events — timeseries audit layer (ADR-025)

> **Schema v1** — Added 2026-06-13. Unified append-only business process audit trail; two TTL-differentiated timeseries collections.

```typescript
// ── Business Process Event Log ───────────────────────────────────────────────

export const BUSINESS_PROCESS_EVENTS_COLLECTION  = 'businessProcessEvent';
export const COMPLIANCE_PROCESS_EVENTS_COLLECTION = 'complianceProcessEvent';

// Transactional processes → businessProcessEvent (TTL 90 days)
export type BusinessProcessType =
  | 'payment_processing'       // SD-64 Payment Order
  | 'fraud_evaluation'         // SD-83 Fraud Diagnosis
  | 'aml_screening'            // SD-99 Suspicious Activity Analysis
  | 'card_authorization'       // SD-254 Card Transaction
  | 'credit_assessment'        // SD-60 Customer Credit Rating
  | 'sanctions_check'          // SD-HRP High Risk Payments
  | 'checkout';                // SD-64 Payment Link checkout flow

// Compliance processes → complianceProcessEvent (TTL 365 days)
export type ComplianceProcessType =
  | 'kyc_verification'         // SD-16 Party Authentication
  | 'kyb_verification'         // SD-89 Merchant Relations
  | 'merchant_onboarding'      // SD-89 Merchant Relations
  | 'customer_onboarding';     // SD-13 Party Data

export type ProcessEventOutcome = 'approved' | 'rejected' | 'pending' | 'failed' | 'escalated';

export interface ProcessEventMeta {
  integrationEventRefs?: string[];      // integrationEventInstanceReference[] — correlated dispatch events
  ruleIds?: string[];                   // compliance rule identifiers
  thresholds?: Record<string, number>;  // e.g. { riskScoreThreshold: 75 }
  [key: string]: unknown;
}

// Shared shape — used by both businessProcessEvent and complianceProcessEvent
export interface BusinessProcessEvent {
  // Timeseries fields
  eventDateTime: Date;                                    // timeField
  processType: BusinessProcessType | ComplianceProcessType; // metaField

  // Identity
  businessProcessEventInstanceReference: string;          // UUID, for idempotency reference
  entityType: BusinessContextRef['entityType'];
  entityId: string;                                       // PK of the business entity

  // Action
  processAction: string;                                  // e.g. 'transaction.authorized', 'kyc.completed'
  processOutcome: ProcessEventOutcome;

  // Actor
  performedByPartyReference: string | null;               // null = system-initiated
  performedByRole: string | null;

  // Audit summary (CHD blocklist applied — no PAN, CVV, cardholderName, expiryDate, trackData)
  eventSummary: Record<string, unknown>;

  // BIAN
  bianServiceDomain: string;
  bianControlRecordType: string;

  // Meta
  processMeta?: ProcessEventMeta;
}

// ── Typed Payload Contracts per Integration Category ─────────────────────────
// Each category has an Outbound (dispatch body) and Inbound (callback body) interface.
// CHD blocklist enforced — PAN, CVV, expiryDate, cardholderName, trackData NEVER appear.

// fraud_detection (SD-83)
export interface FdsOutboundPayload {
  transactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  transactionChannel: string;
  deviceFingerprint?: string;
  ipAddress?: string;
}
export interface FdsInboundPayload {
  riskScore: number;                  // 0–100
  fraudFlag: boolean;
  recommendation: 'approve' | 'review' | 'decline';
  rulesFired?: string[];
}

// aml_monitoring (SD-99)
export interface AmlOutboundPayload {
  partyInstanceReference: string;
  transactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  counterpartyReference?: string;
}
export interface AmlInboundPayload {
  alertLevel: 'none' | 'low' | 'medium' | 'high';
  matchedPatterns?: string[];
  requiresReview: boolean;
}

// kyc_identity (SD-16)
export interface KycOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  partyDateOfBirth?: string;
  partyNationality?: string;
  documentType?: string;
}
export interface KycInboundPayload {
  verificationStatus: 'pass' | 'fail' | 'manual_review';
  confidenceScore: number;            // 0–100
  failureReasons?: string[];
}

// kyb_business (SD-89)
export interface KybOutboundPayload {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantLegalEntityType?: string;
  merchantRegistrationNumber?: string;
  merchantCountry?: string;
}
export interface KybInboundPayload {
  verificationStatus: 'pass' | 'fail' | 'manual_review';
  businessRiskLevel: 'low' | 'medium' | 'high';
  sanctionsMatch: boolean;
  failureReasons?: string[];
}

// hrp_sanctions (SD-HRP)
export interface HrpOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  transactionCountry?: string;
  transactionAmount?: number;
}
export interface HrpInboundPayload {
  sanctionsHit: boolean;
  pepHit: boolean;
  matchedLists?: string[];
  riskRating: 'low' | 'medium' | 'high' | 'blocked';
}

// credit_bureau (SD-60)
export interface CreditBureauOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  requestedCreditAmount?: number;
}
export interface CreditBureauInboundPayload {
  creditScore: number;
  creditRating: string;              // e.g. 'A', 'BB+'
  defaultProbability: number;        // 0–1
}

// card_authorization (SD-254)
export interface CardAuthOutboundPayload {
  cardTransactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  merchantCategoryCode?: string;
  transactionChannel: string;
}
export interface CardAuthInboundPayload {
  authorizationCode: string;
  authorizationStatus: 'approved' | 'declined' | 'referral';
  responseCode: string;
  declineReason?: string;
}

// card_issuer (SD-88)
export interface CardIssuerOutboundPayload {
  paymentCardInstanceReference: string;
  requestType: 'activate' | 'block' | 'replace' | 'status_check';
  reason?: string;
}
export interface CardIssuerInboundPayload {
  cardStatus: 'active' | 'blocked' | 'expired' | 'replaced';
  actionConfirmed: boolean;
  effectiveDateTime?: string;
}

// generic (SD-193)
export interface GenericOutboundPayload {
  eventType: string;
  entityReference: string;
  payload: Record<string, unknown>;
}
export interface GenericInboundPayload {
  status: 'ok' | 'error';
  result?: Record<string, unknown>;
  errorMessage?: string;
}
```

**Collections:**
- `businessProcessEvent` — **timeseries**, no QE. timeField=`eventDateTime`, metaField=`processType`, TTL 90 days, granularity=`hours`.
- `complianceProcessEvent` — **timeseries**, no QE. timeField=`eventDateTime`, metaField=`processType`, TTL 365 days, granularity=`hours`.

**CHD blocklist** (enforced in `eventSummary` at service layer): `pan`, `cardNumber`, `cvv`, `cvv2`, `cvc`, `expiryDate`, `cardExpiry`, `cardholderName`, `trackData`, `track1`, `track2`, `pinBlock`.

**Emission pattern** (fire-and-forget — never blocks request path):
```typescript
void db.collection(BUSINESS_PROCESS_EVENTS_COLLECTION).insertOne(event).catch(() => {});
```

---

### 1.15 RBAC/ACL — data-driven permission model (ADR-030, SD-16)

Authorization is **data-driven, default-deny** (PCI DSS Req 7). The permission **catalog** (resource × action) is static code (`backend/src/shared/models/acl.model.ts`, mirrored in `frontend/src/config/acl.ts`); the role→permission **assignment** is data in the **`role`** collection (CRUD by the `manager`).

**Resources** (→ BIAN SD): `transactions`(SD-254) · `customers`(SD-53) · `cards`(SD-88) · `fraudCases`(SD-83) · `merchants`(SD-89) · `providers`(SD-193) · `modules`(ADR-029) · `authDomains`(SD-16) · `roles` · `auditEvents`(ADR-025) · `consents`.
**Actions** (PCI levels): `view` · `viewSensitive` (CHD/PII — Req 3/7, bound to the escalation flow) · `manage` · `investigate`. Scope `own` for `customer`.

**`role` collection** — `{ roleName (PK, unique), roleLabel, roleDescription, rolePermissions: {[resource]: action[]}, roleScope: 'own'|'all', roleIsBuiltin, bianServiceDomain, bianControlRecordType, recordCreated/UpdatedDateTime }`. Builtin roles are editable (permissions) but not deletable; custom roles support any subset, including full-manage.

**Builtin role matrix (seed):**

| Role | transactions | customers | cards | fraudCases | merchants | providers | modules | authDomains | roles | auditEvents | consents |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **customer** (own) | view | — | view·manage | — | view | — | — | — | — | — | view |
| **level1_analyst** | view | view | view | view·investigate | view | — | — | — | — | view | — |
| **level2_investigator** | view·**viewSensitive** | view·**viewSensitive** | view·**viewSensitive** | view·investigate | view | — | — | — | — | view | — |
| **security_auditor** | view·viewSensitive | view·viewSensitive | view·viewSensitive | view·viewSensitive | view | view | view | — | — | view | — |
| **merchant_officer** | — | — | — | — | view·manage | — | — | — | — | view | — |
| **manager** | **—** | **—** | **—** | **—** | — | view·manage | view·manage | view·manage | view·manage | view | — |

> The `manager` (SD-193 platform admin) has **no** access to business/cardholder data — separation of duties (PCI Req 7). `can('manager','transactions','view') === false` ⇒ **403 backend** (`requirePermission` preHandler) + **`<AccessDenied>` frontend** (`<RequirePermission>`), with the role's responsibilities rendered from the live ACL.

**Enforcement & API:** `requirePermission(resource, action)` (Fastify preHandler, default-deny, cached role load + builtin fallback). `GET /api/v1/acl/effective` returns the caller's resolved permissions (frontend `can()` — permissions never live in the JWT). Roles CRUD: `GET/POST /api/v1/roles`, `GET/PUT/DELETE /api/v1/roles/:roleName` (`roles:manage`; builtin not deletable). Users (local): `GET/POST /api/v1/users`, `PUT/DELETE /api/v1/users/:id` (`authDomains:manage`). Remote role mappings: `partyAuthenticationDomainRoleMappings` on `authenticationDomain` (claim/group → role).

---

## 2. QE encryptedFieldsMaps

All maps live in `backend/src/vendors/encryption/encryptedFieldsMaps.ts`. The `keyId` values are per-field BSON Binary UUIDs resolved at runtime from the provisioned DEKs via `provisionDEKs.ts`.

**DEK naming (as of v3 BIAN compliance update):**

| DEK key | Atlas key vault name | Protects |
|---|---|---|
| `deks.partyEmail` | `DEK-party-email` | `party.partyEmailAddress` |
| `deks.partyPhone` | `DEK-party-phone` | `party.partyMobilePhoneNumber` |
| `deks.authEmail` | `DEK-auth-email` | `customerAuthenticationAssessment.customerAuthenticationEmailAddress` |
| `deks.customerAccountRef` | `DEK-customer-account-ref` | `customerAgreementProcedure.customerAgreementReference` |
| `deks.txAccountRef` | `DEK-tx-account-ref` | `cardTransactionLog.cardTransactionAccountReference` |
| `deks.customerAddress` | `DEK-customer-address` | `customerAgreementProcedure.customerAgreementResidentialAddress` (QE:none, inline v2) |
| `deks.customerGovId` | `DEK-customer-gov-id` | `customerAgreementProcedure.governmentIdentificationReference` (QE:none, inline v2) |
| `deks.customerRiskNotes` | `DEK-customer-risk-notes` | `customerAgreementProcedure.customerAgreementRiskNotes` (QE:none, inline v2) |
| `deks.txRawPayload` | `DEK-tx-raw-payload` | `cardTransactionLog.rawGatewayPayload` (QE:none, inline v2) |
| `deks.txProcessorMeta` | `DEK-tx-processor-meta` | `cardTransactionLog.processorTransactionMetadata` (QE:none, inline v2) |
| `deks.cardExpiry` | `DEK-card-expiry` | `paymentCardManagement.paymentCardExpirationDate` |

```typescript
// backend/src/vendors/encryption/encryptedFieldsMaps.ts
// v2: tier parameter selects which QE:none fields are included in the map.
// Level 1 map omits QE:none fields → driver returns Binary for those fields.
// Level 2 map includes all fields → driver auto-decrypts everything.

export type QETier = 'level1' | 'level2';

export function buildEncryptedFieldsMaps(deks: DEKs, tier: QETier = 'level2') {
  const includeSensitive = tier === 'level2';
  return {

    // ── party (SD-13) ─────────────────────────────────────────────
    party: {
      fields: [
        { keyId: deks.partyEmail,  path: 'partyEmailAddress',      bsonType: 'string', queries: { queryType: 'equality' } },
        { keyId: deks.partyPhone,  path: 'partyMobilePhoneNumber', bsonType: 'string', queries: { queryType: 'equality' } },
      ],
    },

    // ── customerAuthenticationAssessment (SD-91) ──────────────────
    customerAuthenticationAssessment: {
      fields: [
        { keyId: deks.authEmail, path: 'customerAuthenticationEmailAddress', bsonType: 'string', queries: { queryType: 'equality' } },
      ],
    },

    // ── customerAgreementProcedure (SD-53) ────────────────────────
    // QE:equality always included; QE:none sensitive fields only in Level 2 map
    customerAgreementProcedure: {
      fields: [
        { keyId: deks.customerAccountRef, path: 'customerAgreementReference', bsonType: 'string', queries: { queryType: 'equality' } },
        ...(includeSensitive ? [
          { keyId: deks.customerAddress,   path: 'customerAgreementResidentialAddress', bsonType: 'object' },
          { keyId: deks.customerGovId,     path: 'governmentIdentificationReference',   bsonType: 'string' },
          { keyId: deks.customerRiskNotes, path: 'customerAgreementRiskNotes',          bsonType: 'string' },
        ] : []),
      ],
    },

    // ── cardTransactionLog (SD-254) ───────────────────────────────
    // QE:equality always included; QE:none gateway fields only in Level 2 map
    cardTransactionLog: {
      fields: [
        { keyId: deks.txAccountRef, path: 'cardTransactionAccountReference', bsonType: 'string', queries: { queryType: 'equality' } },
        ...(includeSensitive ? [
          { keyId: deks.txRawPayload,    path: 'rawGatewayPayload',            bsonType: 'object' },
          { keyId: deks.txProcessorMeta, path: 'processorTransactionMetadata', bsonType: 'object' },
        ] : []),
      ],
    },

    // ── paymentCardManagement (SD-88) ─────────────────────────────
    paymentCardManagement: {
      fields: [
        { keyId: deks.cardExpiry, path: 'paymentCardExpirationDate', bsonType: 'string' },
      ],
    },

    // fraudDiagnosisCase: no QE (operational metadata only, no PII or CHD)
  };
}
```

---

## 3. Key Management Setup

```typescript
// backend/src/encryption/kms.ts

import { KMSProviders } from 'mongodb';

export function buildKmsProviders(): KMSProviders {
  if (process.env.KMS_PROVIDER === 'local') {
    const key = process.env.LOCAL_MASTER_KEY_BASE64;
    if (!key) throw new Error('LOCAL_MASTER_KEY_BASE64 is required when KMS_PROVIDER=local');
    return {
      local: { key: Buffer.from(key, 'base64') },
    };
  }

  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when KMS_PROVIDER=aws');
  }

  return {
    aws: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      ...(AWS_SESSION_TOKEN && { sessionToken: AWS_SESSION_TOKEN }),
    },
  };
}

export function buildCmkOptions() {
  if (process.env.KMS_PROVIDER === 'local') return undefined;

  const { AWS_CMK_ARN, AWS_REGION } = process.env;
  if (!AWS_CMK_ARN || !AWS_REGION) {
    throw new Error('AWS_CMK_ARN and AWS_REGION are required for AWS KMS');
  }

  return {
    aws: { key: AWS_CMK_ARN, region: AWS_REGION },
  };
}
```

```typescript
// backend/src/encryption/keyVault.ts

import { MongoClient, ClientEncryption } from 'mongodb';
import { buildKmsProviders, buildCmkOptions } from './kms';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

export async function provisionDataEncryptionKeys(client: MongoClient) {
  const kmsProviders = buildKmsProviders();
  const cmkOptions = buildCmkOptions();

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: KEY_VAULT_NAMESPACE,
    kmsProviders,
  });

  const keyVaultColl = client
    .db('encryption')
    .collection('__keyVault');

  async function getOrCreate(keyName: string) {
    const existing = await keyVaultColl.findOne({
      'keyAltNames': keyName,
    });
    if (existing) return existing._id;

    return clientEncryption.createDataKey(
      process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws',
      {
        masterKey: cmkOptions?.aws,
        keyAltNames: [keyName],
      }
    );
  }

  const dekLookupId   = await getOrCreate('DEK-lookup');
  const dekSensitiveId = await getOrCreate('DEK-sensitive');

  return { dekLookupId, dekSensitiveId };
}
```

---

## 4. MongoDB Client Initialization

> **v2**: Two MongoClient pools replace the single client. `getDbForRole(role, hasToken)` in `roleClients.ts` selects the correct pool.

```typescript
// backend/src/vendors/encryption/roleClients.ts (v2)

import { MongoClient, Db } from 'mongodb';
import { buildEncryptedFieldsMaps, QETier } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';
import { buildKmsProviders } from './kms';
import { canReadSensitive } from '../middleware/rbac';
import type { UserRole } from '../../shared/models/identity.model';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';
let _l1Client: MongoClient | null = null;
let _l2Client: MongoClient | null = null;

async function buildQEClient(uri: string, tier: QETier): Promise<MongoClient> {
  // Resolve DEKs with a plain (non-QE) connection
  const plain = new MongoClient(process.env.MONGODB_URI!);
  await plain.connect();
  const deks = await provisionDataEncryptionKeys(plain);
  await plain.close();

  const maps = buildEncryptedFieldsMaps(deks, tier);
  const db = process.env.MONGODB_DB_NAME!;

  const client = new MongoClient(uri, {
    autoEncryption: {
      keyVaultNamespace: KEY_VAULT_NAMESPACE,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${db}.party`]:                            maps.party,
        [`${db}.cardTransactionLog`]:               maps.cardTransactionLog,
        [`${db}.customerAgreementProcedure`]:       maps.customerAgreementProcedure,
        [`${db}.paymentCardManagement`]:            maps.paymentCardManagement,
        [`${db}.customerAuthenticationAssessment`]: maps.customerAuthenticationAssessment,
      },
      extraOptions: { cryptSharedLibRequired: true },
    },
  });
  await client.connect();
  return client;
}

export async function getL1QEClient(): Promise<MongoClient> {
  if (_l1Client) return _l1Client;
  _l1Client = await buildQEClient(process.env.MONGODB_URI_LEVEL1 ?? process.env.MONGODB_URI!, 'level1');
  return _l1Client;
}

export async function getL2QEClient(): Promise<MongoClient> {
  if (_l2Client) return _l2Client;
  _l2Client = await buildQEClient(process.env.MONGODB_URI_LEVEL2 ?? process.env.MONGODB_URI!, 'level2');
  return _l2Client;
}

// Selects L1 or L2 pool based on role + escalation token validity
export async function getDbForRole(role: UserRole, hasValidToken = false): Promise<Db> {
  const client = canReadSensitive(role, hasValidToken) ? await getL2QEClient() : await getL1QEClient();
  return client.db(process.env.MONGODB_DB_NAME!);
}
```

---

## 5. Index Creation

```typescript
// bin/setup.ts (relevant section)

import { MongoClient, ClientEncryption } from 'mongodb';

async function createIndexes(client: MongoClient, dbName: string) {
  const db = client.db(dbName);

  // ── party (SD-13) ─────────────────────────────────────────────────
  await db.collection('party').createIndexes([
    { key: { partyInstanceReference: 1 }, unique: true },
    // Note: partyEmailAddress and partyMobilePhoneNumber are QE:equality —
    // QE manages its own __safeContent__ index; do NOT add manual indexes on these fields
  ]);

  // ── customerAuthenticationAssessment (SD-91) ──────────────────────
  await db.collection('customerAuthenticationAssessment').createIndexes([
    { key: { customerAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { customerAuthenticationUserRole: 1 } },
  ]);

  // ── partyAuthenticationAssessment (SD-16) ─────────────────────────
  await db.collection('partyAuthenticationAssessment').createIndexes([
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
  ]);

  // ── authenticationDomain (SD-16 support) ──────────────────────────
  await db.collection('authenticationDomain').createIndexes([
    { key: { partyAuthenticationDomainInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationDomainName: 1 }, unique: true },
    { key: { partyAuthenticationDomainEnabled: 1 } },
  ]);

  // ── customerAgreementProcedure (SD-53) ────────────────────────────
  await db.collection('customerAgreementProcedure').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },               // two-step lookup join key
    { key: { customerAgreementStatus: 1 } },
  ]);

  // Note: customerAgreementProcedureSensitive collection removed in v2 (fields inline)

  // ── paymentCardManagement (SD-88) ─────────────────────────────────
  await db.collection('paymentCardManagement').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },                 // standard index: token is not QE
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  // ── cardTransactionLog (SD-254) ───────────────────────────────────
  await db.collection('cardTransactionLog').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },                 // standard index: token is not QE
    { key: { cardTransactionDateTime: -1 } },
    { key: { cardTransactionStatus: 1 } },
    // Acquiring-side: list a merchant's received payments, newest first (SD-89). Plaintext id, not QE.
    { key: { merchantAgreementInstanceReference: 1, cardTransactionDateTime: -1 } },
  ]);

  // Note: cardTransactionLogSensitive collection removed in v2 (fields inline)

  // ── fraudDiagnosisCase (SD-83) ────────────────────────────────────
  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { cardTransactionInstanceReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  // fraudDiagnosisCaseEvents: ordered audit retrieval per case
  await db.collection('fraudDiagnosisCaseEvents').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1, actionDateTime: -1 } },
    { key: { fraudDiagnosisInstanceReference: 1, actionType: 1 } },
  ]);

  // ── customerCreditRatingState (SD-60) ─────────────────────────────
  await db.collection('customerCreditRatingState').createIndexes([
    { key: { customerCreditRatingInstanceReference: 1 }, unique: true },
    { key: { customerAgreementReference: 1 } },           // HRPC lookup by account reference
  ]);

  // ── consentAgreement (SD-36) — Open Banking v3 stub ──────────────
  await db.collection('consentAgreement').createIndexes([
    { key: { consentAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { consentRecipientIdentifier: 1 } },
    { key: { consentStatus: 1, consentExpiryDateTime: 1 } },
  ]);

  // ── consentAccessLog (SD-36) — Open Banking audit trail ──────────
  await db.collection('consentAccessLog').createIndexes([
    { key: { consentAccessLogInstanceReference: 1 }, unique: true },
    { key: { consentAgreementInstanceReference: 1, accessDateTime: -1 } },
    { key: { accessDateTime: -1 } },
  ]);
}
```

> **Important:** Do not create manual indexes on QE-encrypted fields (`paymentCardReference`, `customerEmailAddress`, etc.). QE manages its own `__safeContent__` metadata index automatically.

```typescript
  // ── integrationRegistry (SD-193) ─────────────────────────────────
  await db.collection('integrationRegistry').createIndexes([
    { key: { externalProviderArrangementInstanceReference: 1 }, unique: true },
    { key: { externalProviderArrangementType: 1, externalProviderArrangementStatus: 1 } },
    { key: { externalProviderIsInternal: 1 } },
    // Non-unique: multi-provider support — multiple providers can share the same type+endpoint
    { key: { externalProviderArrangementType: 1, externalProviderApiEndpoint: 1 }, sparse: true },
    { key: { routingGroupId: 1 }, sparse: true },
    { key: { routingPriority: 1, externalProviderArrangementType: 1 } },
  ]);

  // ── integrationRoutingGroups (SD-193) ────────────────────────────
  // One default group (isDefaultGroup=true) per IntegrationProviderType, seeded programmatically.
  await db.collection('integrationRoutingGroups').createIndexes([
    { key: { routingGroupInstanceReference: 1 }, unique: true },
    { key: { routingGroupProviderType: 1, routingGroupStatus: 1 } },
    { key: { isDefaultGroup: 1 }, sparse: true },
  ]);

  // ── integrationEvents (SD-193 Action Log) — TIMESERIES (ADR-025) ────────
  // Timeseries collection created in createCollections.ts with expireAfterSeconds: 7776000 (90d).
  // TTL is set on the collection, NOT via a manual TTL index.
  // Unique index on integrationEventInstanceReference removed — incompatible with timeseries.
  await db.collection('integrationEvents').createIndexes([
    { key: { externalProviderArrangementInstanceReference: 1, recordCreatedDateTime: -1 } },
    { key: { integrationEventType: 1, recordCreatedDateTime: -1 } },
    { key: { 'businessContext.entityType': 1, 'businessContext.entityId': 1, recordCreatedDateTime: -1 }, sparse: true },
  ]);

  // ── businessProcessEvent (ADR-025) — TIMESERIES ──────────────────────────
  // Timeseries collection created in createCollections.ts with expireAfterSeconds: 7776000 (90d).
  // Timeseries collections do NOT support unique secondary indexes.
  await db.collection('businessProcessEvent').createIndexes([
    { key: { entityType: 1, entityId: 1, eventDateTime: -1 } },
    { key: { processType: 1, eventDateTime: -1 } },
    { key: { processAction: 1, processOutcome: 1 } },
  ]);

  // ── complianceProcessEvent (ADR-025) — TIMESERIES ────────────────────────
  // Timeseries collection created in createCollections.ts with expireAfterSeconds: 31536000 (365d).
  await db.collection('complianceProcessEvent').createIndexes([
    { key: { entityType: 1, entityId: 1, eventDateTime: -1 } },
    { key: { processType: 1, eventDateTime: -1 } },
  ]);
```

**Timeseries collection creation** (in `createCollections.ts`, not `createIndexes.ts`):

```typescript
// integrationEvents — timeseries (ADR-025: replaces standard collection)
await db.createCollection('integrationEvents', {
  timeseries: {
    timeField: 'recordCreatedDateTime',
    metaField: 'externalProviderArrangementInstanceReference',
    granularity: 'hours',
  },
  expireAfterSeconds: 7776000,  // 90 days
});

// businessProcessEvent — timeseries (ADR-025)
await db.createCollection('businessProcessEvent', {
  timeseries: {
    timeField: 'eventDateTime',
    metaField: 'processType',
    granularity: 'hours',
  },
  expireAfterSeconds: 7776000,  // 90 days (transactional)
});

// complianceProcessEvent — timeseries (ADR-025)
await db.createCollection('complianceProcessEvent', {
  timeseries: {
    timeField: 'eventDateTime',
    metaField: 'processType',
    granularity: 'hours',
  },
  expireAfterSeconds: 31536000, // 365 days (KYC/KYB regulatory)
});

// merchantAgreementEvents — standard collection (ADR-025: was lazily created, now explicit)
await db.createCollection('merchantAgreementEvents');
```

---

## 6. API Contracts

Base URL: `http://localhost:3001/api/v1`

All requests and responses use `Content-Type: application/json`.  
Role is passed via `X-Demo-Role` header (v2+). Omitted defaults to `level1_analyst`.

---

### 6.1 Transactions — `module: transactions` (SD-254 · SD-88)

> Base path: `/api/v1/transactions`

#### `POST /transactions`

Creates a transaction and optionally a fraud case.

**Request body:**
```json
{
  "cardToken": "tok_abc123",
  "accountReference": "ACC-001",
  "amount": 850.00,
  "currency": "USD",
  "cardTransactionMerchantName": "Online Store Inc.",
  "cardTransactionMerchantCategoryCode": "5999",
  "cardTransactionChannel": "online",
  "cardTransactionMaskedPanDisplay": "****-****-****-1234",
  "cardTransactionType": "purchase",
  "cardTransactionDescription": "ONLINE STORE INC.",
  "cardTransactionNarrative": "PURCHASE at Online Store Inc. — ref AB12CD34",
  "gatewayPayload": { "raw": "..." }
}
```

Required: `cardToken`, `accountReference`, `amount`, `currency`, `cardTransactionMerchantName`, `cardTransactionMerchantCategoryCode`, `cardTransactionChannel`, `cardTransactionMaskedPanDisplay`, `cardTransactionType`, `cardTransactionDescription`.
Optional: `cardTransactionNarrative`, `gatewayPayload`.

`cardTransactionType` enum: `purchase | cash_advance | balance_transfer | refund | fee | adjustment`
`cardTransactionDescription`: max 22 chars, visible on cardholder bank statement (BIAN SD-254).

**Response 201:**
```json
{
  "cardTransactionInstanceReference": "uuid-v4",
  "cardTransactionStatus": "authorized",
  "fraudCaseCreated": true,
  "fraudDiagnosisInstanceReference": "uuid-v4"
}
```

---

#### `GET /transactions/:id`

Returns transaction by ID (no QE field values returned to Level 1).

**Response 200:**
```json
{
  "cardTransactionInstanceReference": "...",
  "cardTransactionAmount": { "amount": 850.00, "currency": "USD" },
  "cardTransactionDateTime": "2026-05-26T14:30:00Z",
  "cardTransactionStatus": "authorized",
  "cardTransactionType": "purchase",
  "cardTransactionMerchantName": "Online Store Inc.",
  "cardTransactionMerchantCategoryCode": "5999",
  "cardTransactionMaskedPanDisplay": "****-****-****-1234",
  "cardTransactionDescription": "ONLINE STORE INC.",
  "cardTransactionNarrative": "PURCHASE at Online Store Inc. — ref AB12CD34"
}
```

---

#### `GET /transactions?cardToken=<value>`

Standard index query on `paymentCardReference` (plaintext field: token is a card surrogate, not CHD under PCI DSS v4.0).

**Response 200:**
```json
{
  "results": [ /* CardTransactionLogControlRecord[] */ ],
  "count": 3
}
```

---

### 6.2 Customer — `module: customer` (SD-53)

> Base path: `/api/v1/customer`

#### `GET /customer?email=<value>`
#### `GET /customer?phone=<value>`
#### `GET /customer?accountRef=<value>`

QE equality search on the corresponding encrypted field.

**Response 200:**
```json
{
  "customerAgreementInstanceReference": "...",
  "customerName": "John Doe",
  "customerSegment": "retail",
  "customerAgreementStatus": "active"
}
```

> Encrypted fields (`customerEmailAddress`, `customerMobilePhoneNumber`, `customerAgreementReference`) are not echoed back in the response. They are used only as search predicates.

---

### 6.3 Cards — `module: customer` (SD-88)

> Base path: `/api/v1/customer/:customerId/cards` — cards as sub-resource of Customer Agreement (SD-53)

#### `POST /customer/:customerId/cards`

Registers a tokenized card linked to a customer agreement.

**Request body** (`customerAgreementInstanceReference` is taken from the `:customerId` path param — do not include it in the body):
```json
{
  "cardToken": "tok_abc123",
  "paymentCardExpirationDate": "12/28",
  "paymentCardMaskedPanDisplay": "****-****-****-1234",
  "paymentCardNetwork": "VISA",
  "paymentCardIsPreferred": false
}
```

**Response 201:**
```json
{
  "paymentCardInstanceReference": "uuid-v4",
  "paymentCardStatus": "active"
}
```

---

#### `GET /customer/:customerId/cards`

Returns cards linked to a customer (plaintext lookup by FK).

**Response 200:**
```json
{
  "results": [
    {
      "paymentCardInstanceReference": "...",
      "paymentCardMaskedPanDisplay": "****-****-****-1234",
      "paymentCardNetwork": "VISA",
      "paymentCardStatus": "active",
      "paymentCardIsPreferred": true
    }
  ]
}
```

---

### 6.4 Fraud — `module: fraud` (SD-83)

> Base path: `/api/v1/fraud`

#### `GET /fraud`

**Query params:** `status`, `severity`, `transactionId`, `customerId`, `caseReference` (case-insensitive contains on the human reference, e.g. `FD-2026-001001`), `page` (default 1), `limit` (default 20)

**Response 200:**
```json
{
  "results": [ /* FraudDiagnosisControlRecord[] (no sensitive QE fields) */ ],
  "total": 20,
  "page": 1,
  "limit": 20
}
```

---

#### `GET /fraud/stats`

Investigation analytics for the L1 / L2 / auditor dashboards. MongoDB aggregation returning case `total`, counts by lifecycle (`open`, `underReview`, `escalated`, `resolvedFraud`, `resolvedCleared`), and breakdowns `byStatus`, `bySeverity`, `byMonth`. Aggregates over operational case metadata only — `fraudDiagnosisCase` holds no cardholder PII (PCI DSS Req 3/7). Registered before `/:id` so `stats` is not matched as a case id. (Customers are blocked from `/fraud` by middleware.)

---

#### `GET /fraud/:id`

**Response 200:**
```json
{
  "fraudDiagnosisInstanceReference": "...",
  "fraudDiagnosisCaseReference": "FD-2026-001234",
  "caseStatus": "open",
  "riskSeverity": "high",
  "linkedCardTransactionReference": "...",
  "linkedCustomerAgreementReference": "...",
  "assignedAnalystRole": "level1_analyst",
  "escalationFlag": false,
  "escalationAcceptedAt": null,
  "diagnosisActionLog": []
}
```

`escalationAcceptedAt` (`string | null`) — ISO 8601 timestamp set by L2 when they approve an escalation (`POST /fraud/:id/escalate/approve`). Cleared (set to `null`) when L2 rejects the escalation.

---

#### `POST /fraud/:id/escalate` *(v2 — L1 triggers escalation)*

**Request header:** `X-Demo-Role: level1_analyst`

**Request body:**
```json
{ "escalationReason": "Risk score exceeds L1 threshold. High-risk MCC." }
```

**Response 200:**
```json
{
  "fraudDiagnosisInstanceReference": "...",
  "fraudDiagnosisCaseStatus": "escalated",
  "escalationDateTime": "2026-05-26T15:00:00Z"
}
```

Side effects: case status set to `escalated`; `escalated` event appended to `fraudDiagnosisCaseEvents`.

---

#### `POST /fraud/:id/escalate/approve` *(v2 — L2 approves and gets token)*

**Request header:** `X-Demo-Role: level2_investigator`

**Request body:**
```json
{ "approvalNotes": "Confirmed high-risk transaction. Proceeding with full investigation." }
```

**Response 200:**
```json
{
  "fraudDiagnosisInstanceReference": "...",
  "fraudDiagnosisCaseStatus": "escalated",
  "escalationToken": "4e7a9f2b-c831-4d50-b9f0-1e2a3b4c5d6e",
  "escalationApprovedAt": "2026-05-26T15:05:00Z",
  "tokenExpiresAt": "2026-05-26T19:05:00Z"
}
```

The `escalationToken` is a short-lived UUID (TTL 4 hours) stored in an in-memory token store. Include it in `X-Escalation-Token` on subsequent requests to customer and transaction sensitive endpoints. Side effects: `field_accessed` event appended to `fraudDiagnosisCaseEvents` with `action: "escalation_approved"`.

**Response 422:** Case is not in `escalated` status.

---

#### `POST /fraud/:id/notes` *(Ch-03 — BIAN SD-83 append-only)*

Creates a note on a fraud case. Appends a `note_added` event to `fraudDiagnosisCaseEvents`.

**Auth:** `level1_analyst` or `level2_investigator`. Returns 403 for `customer` or `security_auditor` roles.

**Request header:** `X-Demo-Role: level1_analyst` (or `level2_investigator`)

**Request body:**
```json
{
  "noteText": "Customer confirmed travel to Brazil; merchant appears legitimate.",
  "visibility": "internal"
}
```

`visibility` enum: `internal | customer`

**Response 201:**
```json
{
  "noteId": "uuid-v4",
  "actionDateTime": "2026-06-10T09:15:00Z"
}
```

`noteId` is the `_id` of the inserted `fraudDiagnosisCaseEvents` document.

---

#### `DELETE /fraud/:id/notes/:noteId` *(Ch-03 — retraction, not physical delete)*

Retracts a note by appending a `note_retracted` event to `fraudDiagnosisCaseEvents`. The original `note_added` event is never deleted (BIAN SD-83 append-only).

**Auth:** Same role that created the note. Returns 403 if a different role attempts retraction.

**Request body (optional):**
```json
{ "retractionReason": "Note contained incorrect merchant name." }
```

**Response 200:**
```json
{
  "retractedNoteId": "uuid-v4",
  "retractionDateTime": "2026-06-10T09:30:00Z"
}
```

**Error responses:**
- **403** — requesting role differs from the role that created the note
- **404** — `noteId` not found on this case
- **409** — note has already been retracted

---

#### `GET /fraud/:id/notes` *(Ch-03)*

Returns all notes for a fraud case, including retracted entries (visible to analysts and auditors), sorted chronologically (oldest first).

**Auth:** `level1_analyst`, `level2_investigator`, `security_auditor`. Returns 403 for `customer`.

**Response 200:**
```json
{
  "notes": [
    {
      "noteId": "uuid-v4",
      "noteText": "Customer confirmed travel to Brazil; merchant appears legitimate.",
      "visibility": "internal",
      "performedByRole": "level1_analyst",
      "actionDateTime": "2026-06-10T09:15:00Z",
      "isRetracted": false,
      "retractionReason": null,
      "retractionDateTime": null
    }
  ]
}
```

> **Customer-facing variant:** `GET /api/v1/transactions/:id/notes` returns the same `{ notes: NoteEntry[] }` shape but filters out entries where `isRetracted: true` and restricts to `visibility: "customer"` notes only.

---

#### ~~`fraudDiagnosisCaseNotes`~~ and ~~`fraudDiagnosisCustomerSubjectNotes`~~ — **Deprecated**

> **Deprecated** — These legacy note fields/collections are superseded by `POST /api/v1/fraud/:id/notes`. Legacy data stored under these paths remains **readable** for backward compatibility. **Write operations to these fields are rejected with HTTP 400.** Use the note endpoints above for all new note creation and retraction.

---

### 6.5 Fraud — Audit Events *(v2)*

> Base path: `/api/v1/fraud`

#### `GET /fraud/:id/events`

Returns the chronological event log for a single case.

**Response 200:**
```json
{
  "caseId": "...",
  "events": [
    {
      "actionDateTime": "2026-05-26T14:35:00Z",
      "actionType": "case_opened",
      "performedByRole": "payment_service",
      "actionDetails": { "trigger": "amount_threshold" }
    },
    {
      "actionDateTime": "2026-05-26T15:00:00Z",
      "actionType": "escalated",
      "performedByRole": "level1_analyst",
      "actionDetails": { "escalationReason": "Risk score exceeds L1 threshold." }
    }
  ]
}
```

---

#### `GET /fraud/audit-events` *(v2 — Security Auditor)*

Returns all events across all cases, sorted descending by `actionDateTime`. Joins `fraudDiagnosisCaseReference` from `fraudDiagnosisCase` via aggregation.

**Query params:** `page` (default 1), `limit` (default 50)

**Response 200:**
```json
{
  "events": [
    {
      "fraudDiagnosisInstanceReference": "...",
      "fraudDiagnosisCaseReference": "FD-2026-000001",
      "actionDateTime": "2026-05-26T15:05:00Z",
      "actionType": "field_accessed",
      "performedByInstanceReference": "rbac-layer",
      "performedByRole": "level2_investigator",
      "actionDetails": { "action": "escalation_approved" }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

---

### 6.6 Fraud — HRPC Check *(v2)*

> Base path: `/api/v1/fraud`

#### `GET /fraud/hrpc/check?accountRef=<ref>`

Checks whether a customer account appears in any HRPC (High-Risk Person and Counterparty) category. Queries `customerCreditRatingState` (SD-60) collection by `customerAgreementReference`.

**Query params:** `accountRef` (required) — the customer's account reference (e.g. `ACC-003`).

**Response 200:**
```json
{
  "accountRef": "ACC-003",
  "hrpcMatch": true,
  "highestRiskLevel": "high",
  "hrpcFlags": [
    {
      "category": "suspicious_transaction_patterns",
      "riskLevel": "high",
      "label": "Suspicious Transaction Patterns",
      "description": "Multiple high-value card transactions at high-risk MCC merchants detected over 90 days.",
      "detectedAt": "2026-03-15",
      "source": "internal_transaction_monitoring",
      "reviewRequired": true
    }
  ]
}
```

Returns `hrpcMatch: false` and empty `hrpcFlags` when no profile exists for the given account reference. No 404 is returned — absence of a profile is a valid and expected result.

---

### 6.7 Diagnostics *(v3)*

#### `GET /diagnostics/query-timing`

**Query params:** `field` (e.g., `email`), `value`

**Response 200:**
```json
{
  "field": "customerEmailAddress",
  "encrypted_ms": 18,
  "plaintext_ms": 12,
  "overhead_pct": 50
}
```

---

### 6.7 Authentication

All auth endpoints are public (no JWT required).

#### `POST /auth/login`

Validates credentials against `customerAuthenticationAssessment` (SD-91, QE equality search on `customerAuthenticationEmailAddress`). Returns a signed JWT on success.

**Request body:**
```json
{
  "email": "sarah.chen@back.es",
  "password": "demo-password",
  "domain": "local"
}
```

**Response 200:**
```json
{
  "token": "<HS256 JWT>",
  "user": {
    "customerAuthenticationInstanceReference": "uuid-v4",
    "name": "Sarah Chen",
    "email": "sarah.chen@back.es",
    "role": "level1_analyst"
  }
}
```

**Response 401:** `{ "error": "Invalid credentials" }`

---

#### `GET /auth/users`

Returns the list of local domain demo users for the login screen dropdown. Data is read from `backend/data/customerAuthentications.json` (seed file) rather than the QE-encrypted collection to avoid decryption overhead on this helper endpoint. Passwords are never included.

Pass `?featured=true` to return only the curated demo roster (`customerAuthenticationDemoFeatured: true`) surfaced in the debug-mode user picker (application mode) and used by the simulator. The full set of seeded users remains available without the filter for ad-hoc testing.

#### `GET /fraud/integrity` *(security_auditor only)*

Data-integrity oversight for the auditor dashboard (PCI DSS Req 10). Returns `totalCases`, `duplicateCount` + `duplicateReferences[]` (case references on more than one case — must be 0; enforced by the unique index, ADR-024), `orphanTransactionRefs`, `orphanCustomerRefs`, and a `healthy` flag. Aggregates only — no PII. Non-auditor roles receive 403.

**Response 200:**
```json
{
  "users": [
    { "email": "luis.fernandez@back.es", "name": "Luis Fernandez", "role": "customer" },
    { "email": "julia.santos@back.es",   "name": "Julia Santos",   "role": "customer" },
    { "email": "sarah.chen@back.es",     "name": "Sarah Chen",     "role": "level1_analyst" },
    { "email": "michael.obi@back.es",    "name": "Michael Obi",    "role": "level2_investigator" },
    { "email": "admin@back.es",          "name": "Admin",          "role": "security_auditor" }
  ]
}
```

---

#### `GET /auth/domains`

Returns only enabled authentication domains from the `authenticationDomain` collection (BIAN SD-16). Public endpoint — no Bearer token required. Used by the Application Mode login screen to populate the domain selector dynamically.

**Response 200:**
```json
{
  "domains": [
    { "name": "local", "displayName": "Local (Demo Users)", "type": "local" }
  ]
}
```

> Domains with `partyAuthenticationDomainEnabled: false` (e.g., `msentra`, `bigid`) are excluded. Enable them by updating the `authenticationDomain` collection document.

---

#### `GET /transactions/merchants`

Returns unique `{ name, mcc }` pairs aggregated from the `cardTransactionLog` collection, sorted alphabetically. Public endpoint — used by the Simulator STEP 1 form to populate the Merchant Name selector.

**Response 200:**
```json
{
  "merchants": [
    { "name": "TechGadgets Ltd.", "mcc": "5734" },
    { "name": "City Restaurant", "mcc": "5812" }
  ]
}
```

---

### 6.8 Raw Document (Demo Tool)

Available only when `NODE_ENV !== 'production'`. Used by the "Encrypted in Atlas" toggle in both modes.

#### `GET /demo/raw-document/:collection/:id`

Returns the raw BSON document as stored in Atlas (ciphertext visible, no auto-decryption). Uses a plain MongoClient without `autoEncryption`.

**Path params:** `collection` (e.g., `cardTransactionLog`), `id` (document `_id` or primary key value)

**Response 200:**
```json
{
  "collection": "cardTransactionLog",
  "document": {
    "_id": "...",
    "paymentCardReference": { "$binary": { "base64": "BhKJ9KMsA...", "subType": "06" } },
    "customerEmailAddress": { "$binary": { "base64": "AqF8M9jl...", "subType": "06" } },
    "cardTransactionAmount": { "amount": 850, "currency": "USD" }
  }
}
```

**Response 403:** Returned if `NODE_ENV === 'production'`.

---

### 6.9 Health

#### `GET /api/v1/system/health`

**Response 200:**
```json
{
  "status": "ok",
  "atlas": "connected",
  "kmsProvider": "aws",
  "timestamp": "2026-05-26T14:00:00Z"
}
```

---

### 6.10 Business Process Events (ADR-025)

> Base path: `/api/v1/events`  
> Authorized roles: `security_auditor`, `system_admin`. All other roles → 403.

#### `GET /api/v1/events/process`

Returns paginated `businessProcessEvent` documents.

**Query params:** `processType` (optional), `entityType` (optional), `from` (ISO date, optional), `to` (ISO date, optional), `page` (default 1), `limit` (default 20, max 100)

**Response 200:**
```json
{
  "events": [
    {
      "businessProcessEventInstanceReference": "uuid",
      "eventDateTime": "2026-06-13T10:00:00Z",
      "processType": "payment_processing",
      "processAction": "transaction.authorized",
      "processOutcome": "approved",
      "entityType": "transaction",
      "entityId": "txn-001",
      "performedByPartyReference": null,
      "performedByRole": null,
      "eventSummary": { "amount": 850, "currency": "USD" },
      "bianServiceDomain": "Card Transaction",
      "bianControlRecordType": "CardTransactionRecord"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

#### `GET /api/v1/events/process/:entityType/:entityId`

Returns all process events for a specific business entity.

**Path params:** `entityType` (`transaction` | `fraud_case` | `customer` | `merchant` | `payment_link` | `card`), `entityId` (entity primary key)

**Query params:** `page` (default 1), `limit` (default 50)

**Response 200:** Same shape as `GET /events/process` but filtered to the entity.

---

#### `GET /api/v1/events/compliance`

Returns paginated `complianceProcessEvent` documents.

**Query params:** `processType` (optional, `kyc_verification` | `kyb_verification` | `merchant_onboarding` | `customer_onboarding`), `from`, `to`, `page`, `limit`

**Response 200:** Same shape as `GET /events/process`.

---

### 6.11 Internal Integration Stubs (ADR-025)

> Base path: `/api/v1/internal`  
> No JWT required. Validated via `X-Integration-Source: internal` header → 401 if absent.  
> Not exposed in public Swagger.

All internal stub endpoints follow the same request/response shape (typed per category).

#### `POST /api/v1/internal/fds/score`

**Request body:** `FdsOutboundPayload`  
**Response 200:** `FdsInboundPayload`

#### `POST /api/v1/internal/aml/score`

**Request body:** `AmlOutboundPayload`  
**Response 200:** `AmlInboundPayload`

#### `POST /api/v1/internal/kyc/score`

**Request body:** `KycOutboundPayload`  
**Response 200:** `KycInboundPayload`

#### `POST /api/v1/internal/kyb/score`

**Request body:** `KybOutboundPayload`  
**Response 200:** `KybInboundPayload`

#### `POST /api/v1/internal/hrp/score`

**Request body:** `HrpOutboundPayload`  
**Response 200:** `HrpInboundPayload`

#### `POST /api/v1/internal/card_auth/score`

**Request body:** `CardAuthOutboundPayload`  
**Response 200:** `CardAuthInboundPayload`

#### `POST /api/v1/internal/card_issuer/score`

**Request body:** `CardIssuerOutboundPayload`  
**Response 200:** `CardIssuerInboundPayload`

---

## 7. Environment Variables Reference

```bash
# .env  (see backend/src/vendors/setup/env.example for full reference)

# ── MongoDB connection ─────────────────────────────────────────────
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=pcidb

# v2: role-pool connection strings (fall back to MONGODB_URI if not set)
MONGODB_URI_LEVEL1=mongodb+srv://<l1-user>:<l1-pass>@<cluster>.mongodb.net/
MONGODB_URI_LEVEL2=mongodb+srv://<l2-user>:<l2-pass>@<cluster>.mongodb.net/

# ── KMS / Queryable Encryption ────────────────────────────────────
KMS_PROVIDER=local              # 'local' | 'aws'
LOCAL_MASTER_KEY=               # 96-byte hex (generated by `npm run setup:key`)
AWS_KMS_KEY_ARN=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
CRYPT_SHARED_LIB_PATH=          # Path to mongo_crypt_v1 shared library

# ── Atlas Admin API (v2 setup automation) ─────────────────────────
# Leave blank to skip; roles must be created manually in Atlas UI instead.
ATLAS_PUBLIC_KEY=
ATLAS_PRIVATE_KEY=
ATLAS_PROJECT_ID=
ATLAS_DB_USER_LEVEL1=pci_l1
ATLAS_DB_USER_LEVEL1_PASSWORD=
ATLAS_DB_USER_LEVEL2=pci_l2
ATLAS_DB_USER_LEVEL2_PASSWORD=

# ── Backend (Fastify) ─────────────────────────────────────────────
PORT=3001
NODE_ENV=development
JWT_SECRET=                     # 32-char random string

# ── Fraud detection ────────────────────────────────────────────────
FRAUD_AMOUNT_THRESHOLD=500
RISK_MCC_LIST=5812,6011,7995
ESCALATION_TOKEN_TTL_SECONDS=3600
```

---

## 8. Seed Data Schema

Seed files live in `backend/data/`. The seed script (`backend/bin/seed.ts`) reads each file and performs upsert operations using the collection's primary key as the filter.

### Seed volumes

| File | Collection (BIAN SD) | Documents | Generator |
|---|---|---|---|
| `backend/data/parties.json` | `party` (SD-13) | 53 (50 customers + 3 employees) | `bin/generate.ts` |
| `backend/data/customerAuthentications.json` | `customerAuthenticationAssessment` (SD-91) | 5 | `bin/generate.ts` |
| `backend/data/authDomains.json` | `authenticationDomain` (SD-16) | 3 | manual |
| `backend/data/customerAgreements.json` | `customerAgreementProcedure` (SD-53) | 50 | `bin/generate.ts` — includes inline QE:none fields (v2) |
| `backend/data/paymentCards.json` | `paymentCardManagement` (SD-88) | 50 | `bin/generate.ts` |
| `backend/data/cardTransactions.json` | `cardTransactionLog` (SD-254) | 200 | `bin/generate.ts` — includes inline QE:none fields (v2) |
| `backend/data/fraudCases.json` | `fraudDiagnosisCase` (SD-83) | 20 | `bin/generate.ts` |
| `backend/data/fraudCaseEvents.json` | `fraudDiagnosisCaseEvents` (SD-83) | 20 | `bin/generate.ts` |
| `backend/data/customerCreditRatings.json` | `customerCreditRatingState` (SD-60) | 5 | manual (HRPC profiles) |

**Regenerating synthetic data:** Run `npm run setup:data --prefix backend` (executes `bin/generate.ts`). This overwrites all files marked `bin/generate.ts` above. Manual files (`authDomains.json`, `customerCreditRatings.json`) are never overwritten by the generator.

### Demo users (`data/customerAuthentications.json`)

Credentials are stored in `customerAuthenticationAssessment` (SD-91). Passwords stored as bcrypt hashes (12 rounds). Email is a QE:equality field. Plaintext passwords are in `.env.example` comments for demo convenience only.

| Email | Role | Display Name |
|---|---|---|
| `luis.fernandez@back.es` | `customer` | Luis Fernandez |
| `julia.santos@back.es` | `customer` | Julia Santos |
| `sarah.chen@back.es` | `level1_analyst` | Sarah Chen |
| `michael.obi@back.es` | `level2_investigator` | Michael Obi |
| `admin@back.es` | `security_auditor` | Admin |

Each of these 5 users has a corresponding `party` document in `parties.json` linked via `partyInstanceReference`.

### Synthetic data rules

- All personal data (names, emails, phones, addresses) is generated with `@faker-js/faker`
- Card tokens use the format `tok_<uuid>`: never a real card number
- `paymentCardMaskedPanDisplay` / `cardTransactionMaskedPanDisplay` format: `****-****-****-XXXX` where XXXX is a random 4-digit suffix
- `paymentCardExpirationDate` is always a future date (at least 12 months from generation)
- CVV, PIN, full PAN, and magnetic stripe data are **never included** in seed files
- Government IDs use a format that is clearly synthetic: `SYNTH-<random-8-digits>`
- Fraud cases are linked to the first 20 transactions (indices 0–19) in the transactions seed

### Upsert key per collection

| Collection (BIAN name) | Upsert filter key |
|---|---|
| `party` | `partyInstanceReference` |
| `customerAuthenticationAssessment` | `customerAuthenticationInstanceReference` |
| `partyAuthenticationAssessment` | `partyAuthenticationInstanceReference` |
| `authenticationDomain` | `partyAuthenticationDomainInstanceReference` |
| `customerAgreementProcedure` | `customerAgreementInstanceReference` |
| `paymentCardManagement` | `paymentCardInstanceReference` |
| `cardTransactionLog` | `cardTransactionInstanceReference` |
| `fraudDiagnosisCase` | `fraudDiagnosisInstanceReference` |
| `fraudDiagnosisCaseEvents` | `fraudDiagnosisInstanceReference` + `actionDateTime` |
| `customerCreditRatingState` | `customerCreditRatingInstanceReference` |
| `consentAgreement` *(v3 stub)* | `consentAgreementInstanceReference` |
| `consentAccessLog` *(v3 stub)* | `consentAccessLogInstanceReference` |

---

## 9. Backend Source Structure

The backend uses a **domain-module layout** aligned with BIAN Service Domains. See [engineering-proposal.md §3.8](engineering-proposal.md#38-backend-module-architecture-and-bian-map) for the full BIAN module map, shared/vendors boundary rules, and dependency graph.

```
backend/
├── bin/
│   ├── setup.ts                    # thin wrapper → src/vendors/setup/runSetup()
│   ├── seed.ts                     # thin wrapper → src/vendors/seed/runSeed()
│   └── generate.ts                 # synthetic data generator → writes backend/data/*.json
│
├── data/                           # JSON seed files (consumed by bin/seed.ts only)
│   ├── parties.json                # generated → party (SD-13): 53 party records
│   ├── customerAuthentications.json # generated → customerAuthenticationAssessment (SD-91): 5 users
│   ├── authDomains.json            # manual: local + msentra + bigid domains
│   ├── customerAgreements.json     # generated → customerAgreementProcedure (SD-53) [inline QE:none v2]
│   ├── paymentCards.json           # generated → paymentCardManagement (SD-88)
│   ├── cardTransactions.json       # generated → cardTransactionLog (SD-254) [inline QE:none v2]
│   ├── fraudCases.json             # generated → fraudDiagnosisCase (SD-83)
│   ├── fraudCaseEvents.json        # generated → fraudDiagnosisCaseEvents (SD-83)
│   ├── customerCreditRatings.json  # manual: 5 HRPC profiles → customerCreditRatingState (SD-60)
│   └── merchants.json              # [v4] seed data for merchantAgreement collection
│
└── src/
    │
    ├── shared/                     # Business logic shared by 2+ modules
    │   ├── models/
    │   │   ├── risk.model.ts       # RiskSeverity · FraudTriggerInput
    │   │   ├── identity.model.ts   # UserRole · AnalystRole · JwtDemoPayload
    │   │   └── transaction.model.ts # TransactionSnapshot (defined in fraud, built in transactions)
    │   └── services/
    │       └── fraudTrigger.service.ts  # [v4] triggerFraudEvaluation() — shared when gateway also triggers fraud
    │
    ├── vendors/                    # Infrastructure shared by all modules (no business logic)
    │   ├── encryption/
    │   │   ├── qeClient.ts         # MongoClient with autoEncryption (QE)
    │   │   ├── rawClient.ts        # Plain MongoClient (ciphertext view for simulator toggle)
    │   │   ├── kms.ts              # buildKmsProviders() · buildCmkOptions()
    │   │   ├── keyVault.ts         # provisionDataEncryptionKeys(): DEK-lookup + DEK-sensitive
    │   │   └── encryptedFieldsMaps.ts  # buildEncryptedFieldsMaps(): QE schemas for all collections
    │   ├── middleware/
    │   │   ├── auth.ts             # JWT verification (Fastify preHandler, all routes)
    │   │   └── rbac.ts             # Role enforcement (Fastify preHandler, protected routes)
    │   ├── setup/
    │   │   ├── index.ts            # runSetup(): orchestrates all setup steps
    │   │   ├── createCollections.ts
    │   │   ├── createIndexes.ts
    │   │   └── provisionDEKs.ts
    │   └── seed/
    │       ├── index.ts            # runSeed(): orchestrates all seed steps
    │       ├── seedUsers.ts
    │       ├── seedAuthDomains.ts
    │       ├── seedCustomers.ts
    │       ├── seedCards.ts
    │       ├── seedTransactions.ts
    │       ├── seedCases.ts
    │       ├── seedCreditRatings.ts  # BIAN SD-60: upserts customerCreditRatings.json
    │       └── seedMerchants.ts    # [v4]
    │
    ├── modules/                    # Domain modules — one per BIAN SD cluster
    │   │
    │   ├── identity/               # BIAN SD-16: Party Authentication
    │   │   ├── controllers/
    │   │   │   └── auth.controller.ts
    │   │   ├── services/
    │   │   │   └── auth.service.ts         # JWT sign/verify, bcrypt compare
    │   │   ├── models/
    │   │   │   └── partyAuthentication.model.ts
    │   │   └── index.ts                    # Fastify plugin → /auth/login
    │   │
    │   ├── customer/               # BIAN SD-53: Customer Agreement
    │   │   ├── controllers/
    │   │   │   └── customerAgreement.controller.ts
    │   │   ├── services/
    │   │   │   └── customerAgreement.service.ts  # QE equality search (email/phone/accountRef)
    │   │   ├── models/
    │   │   │   └── customerAgreement.model.ts
    │   │   └── index.ts                    # Fastify plugin → /customer + /customer/:id/cards
    │   │
    │   ├── transactions/           # BIAN SD-254: Card Transaction · SD-88: Payment Card
    │   │   ├── controllers/
    │   │   │   ├── cardTransaction.controller.ts
    │   │   │   └── paymentCard.controller.ts
    │   │   ├── services/
    │   │   │   ├── cardTransaction.service.ts   # writes QE fields; imports createFraudCase from fraud/
    │   │   │   └── paymentCard.service.ts
    │   │   ├── models/
    │   │   │   ├── cardTransaction.model.ts
    │   │   │   └── paymentCard.model.ts
    │   │   └── index.ts                    # Fastify plugin → /transactions
    │   │
    │   ├── fraud/                  # BIAN SD-83: Fraud Diagnosis
    │   │   ├── controllers/
    │   │   │   └── fraudDiagnosis.controller.ts
    │   │   ├── services/
    │   │   │   └── fraudDiagnosis.service.ts    # createFraudCase(); getCases(); getCaseById()
    │   │   ├── models/
    │   │   │   └── fraudDiagnosis.model.ts
    │   │   └── index.ts                    # Fastify plugin → /fraud (+ /fraud/:id/events in v2)
    │   │
    │   ├── gateway/                # [v4] BIAN SD-64+SD-65+SD-89+SD-57
    │   │   ├── controllers/
    │   │   │   ├── merchant.controller.ts
    │   │   │   ├── payment.controller.ts    # /gateway/payments lifecycle
    │   │   │   ├── token.controller.ts
    │   │   │   └── webhook.controller.ts
    │   │   ├── services/
    │   │   │   ├── merchant.service.ts      # SD-89: merchant CRUD + limit validation
    │   │   │   ├── paymentOrder.service.ts  # SD-64: initiated→authorized→captured→settled
    │   │   │   ├── routing.service.ts       # SD-65: simulated processor routing
    │   │   │   ├── tokenization.service.ts  # SD-57: token vault operations
    │   │   │   └── webhook.service.ts       # webhook delivery + retry
    │   │   ├── models/
    │   │   │   ├── merchantAgreement.model.ts   # SD-89: MCC, limits, settlement config
    │   │   │   ├── paymentOrder.model.ts         # SD-64: payment intent lifecycle
    │   │   │   └── tokenVault.model.ts           # SD-57: token references
    │   │   └── index.ts                    # Fastify plugin → /gateway/*
    │   │
    │   └── system/                 # Demo infrastructure (non-BIAN)
    │       ├── controllers/
    │       │   └── demo.controller.ts       # raw-document endpoint + diagnostics
    │       └── index.ts                    # Registered only when NODE_ENV !== 'production'
    │
    ├── plugins/
    │   ├── mongodb.ts              # Fastify plugin: registers QE client on fastify.db
    │   ├── swagger.ts
    │   └── cors.ts
    │
    └── server.ts                   # Registers shared schemas, plugins, middleware, and all modules
```

**Cross-module dependency rule:** `transactions` imports `createFraudCase` from `modules/fraud/` directly (permanent, unidirectional). All other cross-module dependencies are types from `shared/models/` (no runtime cost). In v4, `shared/services/fraudTrigger.service.ts` is introduced when `gateway` becomes a second caller of fraud case creation.

**API URL semantics follow REST nesting.** Cards (SD-88) are a sub-resource of Customer Agreement (SD-53): `/api/v1/customer/:id/cards`. Other resources are top-level: `/api/v1/transactions` (SD-254), `/api/v1/fraud` (SD-83), `/api/v1/auth` (SD-16).

`backend/bin/setup.ts` and `backend/bin/seed.ts` are thin wrappers inside the backend package:

```typescript
// backend/bin/setup.ts
import { runSetup } from '../src/vendors/setup';
runSetup().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

// backend/bin/seed.ts
import { runSeed } from '../src/vendors/seed';
runSeed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
```

`backend/package.json` exposes the scripts; the root delegates to them:

```json
// backend/package.json
{
  "scripts": {
    "setup:db": "ts-node bin/setup.ts",
    "seed":     "ts-node bin/seed.ts"
  }
}
```

```json
// root package.json (relevant entries)
{
  "scripts": {
    "setup:db":   "npm run setup:db --prefix backend",
    "setup:seed": "npm run seed --prefix backend"
  }
}
```

---

## 8. Ch-04 Payment Integration: Redirect Checkout + Payment Links

### 8.0 Merchant payment callback (PSP → merchant, ADR-010/025/028)
After a payment is processed (hosted checkout **or** payment link), the PSP notifies the merchant via
`sendMerchantPaymentCallback`, on **both** approval and decline, through TWO channels:
1. **The merchant's own webhook** (per-merchant): `deliverWebhook` POSTs the HMAC-signed event to the
   merchant's `merchantWebhookEndpoint` using `merchantWebhookSecret`. Each merchant has a **distinct**
   endpoint (seeded), so the correct merchant is notified per its configuration (ADR-028).
2. **The Integration Hub** OUTBOUND event (`dispatchIntegration`, type `generic` — the seeded
   "Merchant Payment Notifications" provider) as the auditable inbound/outbound record.

**Single chokepoint (ADR-028/PM-4).** The **approved** callback is fired inside `createTransaction`,
so it covers EVERY merchant-attributed payment — app/api-card, hosted checkout and payment link — not
just the gateway flows. A third effect is added: a unified-audit **businessProcessEvent**
`payment.callback` (entityType=transaction) so the outcome is visible/searchable in `/system/audit-events`
for manager/auditor (previously only `transaction.authorized` appeared). The webhook payload always
includes the **transactionId**. Declines fire the callback per-flow (a decline never reaches
`createTransaction`).

**Webhook test + lifecycle events (PM-5).** `POST /merchants/:id/webhooks/test` (owner/officer) delivers
a simulated `payment.completed` (HMAC-signed, `test:true`) to the merchant's endpoint so they can verify
their integration without a payment — returns the payload + delivery outcome (status, attempts, response).
The `payment.callback` audit event now records the actual webhook **method/headers/body + the merchant's
response** (delivered/statusCode/attempts), not just `webhookConfigured`. Each payment also emits a
`payment.card.validation` (card_issuer integrator) before charging, and a `card.registered` (new) or
`card.matched` (existing) compliance event — full card lifecycle behind a transaction for the auditor.
(If `webhookConfigured` is false, the merchant has no endpoint in the DB — set it in
`/system/merchant/webhooks` or re-seed.)

**Auditable search + capture (PM-4).** `/events/audit` adds a `ref` deep-match filter (entityId +
event summary/payload) so the auditor finds EVERY event for a transaction id, case id, merchant,
customer/account ref or card token; integration events use their `businessContext` for entity linking.
Integration events now persist `integrationEventRequest` {method,url,headers,body} and
`integrationEventResponse` {status,headers,body} (sanitized) for outbound dispatch and inbound
callbacks (PCI DSS Req 10.7).

The event carries on **both** outcomes:
- **Approved** → `payment.completed` with `cardToken` (surrogate, not CHD), `maskedPan`,
  `responseCode`, `authorizationCode`, amount/currency, references.
- **Declined** → `payment.declined` with `cardToken`, `responseCode` (e.g. `0540` = card
  deactivated/removed) and a human `declineReason`. The decline path also returns a `redirectUrl`
  and the real `code`/reason (no longer hard-coded `0190`).

PCI DSS Req 3: the callback carries only the surrogate token + masked PAN — never the PAN/CVV
(`logEvent` also applies the CHD blocklist). The browser return URL receives the same outcome via
`{result}`, `{card_token}`, `{response_code}`, `{reason}` placeholders. The integration event is
auditable in the events stream (Req 10). Saving the card is the merchant's decision on receiving
this callback — not a checkbox in the PSP-hosted payment UI.

### 8.1 New TypeScript Models

#### `CheckoutSessionRecord` (SD-64 — `checkoutSessionLog`)

```typescript
// backend/src/modules/gateway/models/checkoutSession.model.ts
export const CHECKOUT_SESSION_COLLECTION = 'checkoutSessionLog';

export type CheckoutSessionStatus = 'pending' | 'completed' | 'expired' | 'cancelled';

export interface CheckoutSessionRecord {
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'CheckoutSessionLog';
  schemaVersion: 1;
  checkoutSessionInstanceReference: string;        // UUID
  merchantAgreementInstanceReference: string;      // FK → merchantAgreementProcedure
  merchantName: string;
  checkoutSessionAmount: number;
  checkoutSessionCurrency: string;                 // ISO 4217
  checkoutSessionDescription: string;
  checkoutSessionStatus: CheckoutSessionStatus;
  checkoutSessionReturnUrl: string;
  checkoutSessionCancelUrl: string;
  checkoutSessionMerchantReference: string;        // Merchant's own order ID
  checkoutSessionCreatedDateTime: Date;
  checkoutSessionExpiresAt: Date;                  // TTL index target — 30 min default
  checkoutSessionCompletedDateTime?: Date;
  cardTransactionInstanceReference?: string;       // Set on completion
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}
```

#### `PaymentLinkRecord` (SD-64 — `paymentLinkRecord`)

```typescript
// backend/src/modules/gateway/models/paymentLink.model.ts
export const PAYMENT_LINK_COLLECTION = 'paymentLinkRecord';

export type PaymentLinkStatus = 'active' | 'completed' | 'expired' | 'deactivated';
export type PaymentLinkUsageType = 'single_use' | 'multi_use';

export interface PaymentLinkRecord {
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentLinkRecord';
  schemaVersion: 1;
  paymentLinkInstanceReference: string;            // UUID
  paymentLinkCode: string;                         // 8-char, unique index
  merchantAgreementInstanceReference: string;      // FK → merchantAgreementProcedure
  merchantName: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;                     // ISO 4217
  paymentLinkDescription: string;
  paymentLinkCustomerMessage?: string;
  paymentLinkStatus: PaymentLinkStatus;
  paymentLinkUsageType: PaymentLinkUsageType;
  paymentLinkCurrentUses: number;
  paymentLinkMaxUses?: number;                     // multi_use cap
  paymentLinkCreatedDateTime: Date;
  paymentLinkExpiresAt?: Date;                     // Sparse TTL index — optional
  paymentLinkTransactionReferences: string[];      // FK array → cardTransactionLog
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}
```

#### `MerchantAgreementControlRecord` update (SD-89 — `merchantAgreementProcedure`)

> **Ch-06 update**: Added `merchantAgreementKybCheck` as a **BIAN BQ:Step** sub-document. This replaces the loose top-level review fields as the authoritative KYB record. Top-level fields (`merchantReviewNote`, `merchantReviewedByPartyReference`, `merchantReviewedDateTime`) are retained for backward compatibility. `schemaVersion` bumped to 2.

Added to the existing merchant model:

```typescript
export interface MerchantApiKeyRecord {
  keyId: string;           // UUID — used for revocation
  keyPrefix: string;       // First 12 chars for display (e.g., "lbpk_live_ab")
  keyHashBcrypt: string;   // bcrypt hash — NEVER store plaintext
  keyStatus: 'active' | 'revoked';
  keyCreatedDateTime: Date;
  keyLastUsedDateTime?: Date;
}

// Added / corrected fields on MerchantAgreementControlRecord:
merchantApiKeys: MerchantApiKeyRecord[];
merchantWebhookSecret?: string;          // HMAC signing secret for webhook delivery

// D-21 (BIAN audit 2026-06-10): Party owner link — canonical BIAN cross-domain reference.
// Points to the partyInstanceReference (SD-13) of the individual or legal entity that owns
// this merchant agreement. Enables the dual-role pattern: the same Party can hold both a
// CustomerAgreement (SD-53) and a MerchantAgreement (SD-89).
// Correct field is merchantOwnerPartyReference (NOT customerReference) because
// 'customer' is a role-scoped concept (SD-53 contract), while 'Party' is the identity anchor.
merchantOwnerPartyReference?: string;    // FK → party.partyInstanceReference (SD-13)

// Ch-05: Review metadata (top-level) — kept for backward compat. Set by merchant_officer.
merchantReviewNote?: string;                     // Officer's comment for audit trail
merchantReviewedByPartyReference?: string;       // FK → party.partyInstanceReference (SD-13) of reviewing employee
merchantReviewedDateTime?: Date;                 // When the review decision was made

// Ch-06: BQ:Step — KYB business verification (BIAN SD-89 BQ:Step). PCI DSS Req 12.8.
// Authoritative KYB record. Status vocabulary: initiated | verified | rejected | expired.
// All fields use BIAN-canonical BQ naming prefix: merchantAgreementKybCheck*.
merchantAgreementKybCheck?: MerchantAgreementKybCheck;

// Ch-05: Full BIAN SD-89 Agreement lifecycle including KYB review states.
// BIAN Action Terms: Initiate (customer) → Control (merchant_officer) → Update (amend) → Terminate (close)
type MerchantAgreementStatus =
  | 'initiated'      // Customer submits application (Initiate)
  | 'under_review'   // merchant_officer performing KYB validation (BQ:Step KybCheck)
  | 'agreed'         // KYB passed; T&C presented to applicant (Control: approve)
  | 'active'         // Applicant accepted T&C; API key issued; can process payments
  | 'amended'        // Terms updated by merchant_officer (Update)
  | 'suspended'      // Temporarily blocked — fraud investigation or compliance hold
  | 'rejected'       // KYB failed or compliance issue (Control: reject)
  | 'closed';        // Agreement terminated (Terminate)

// Ch-06: BQ:Step — KYB business verification types
type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

interface MerchantAgreementKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: Date;
  merchantAgreementKybCheckReference?: string;      // Trade register / AML screening reference
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;  // FK → party (reviewing officer)
}
```

Key format: `lbpk_live_<32 hex chars>` — plaintext returned once on generation; only bcrypt hash persisted.

---

### 8.2 New Index Strategy

```typescript
// merchantAgreementProcedure
{ merchantAgreementInstanceReference: 1 }  // unique
{ merchantAgreementStatus: 1 }
{ merchantCategoryCode: 1 }
{ merchantOwnerPartyReference: 1 }         // Ch-05: dual-role lookup — find merchant by owner Party

// checkoutSessionLog
{ checkoutSessionInstanceReference: 1 }    // unique
{ merchantAgreementInstanceReference: 1 }
{ checkoutSessionMerchantReference: 1, merchantAgreementInstanceReference: 1 }
{ checkoutSessionExpiresAt: 1 }             // TTL: expireAfterSeconds: 0

// paymentLinkRecord
{ paymentLinkInstanceReference: 1 }        // unique
{ paymentLinkCode: 1 }                      // unique
{ merchantAgreementInstanceReference: 1 }
{ paymentLinkStatus: 1 }
{ paymentLinkExpiresAt: 1 }                 // Sparse TTL: expireAfterSeconds: 0, sparse: true
```

---

### 8.3 API Contracts

All routes are under the `/api/v1` prefix.

#### Redirect Checkout (Method A) — prefix `/checkout`

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/checkout/sessions` | JWT | Create checkout session; returns `paymentPageUrl` |
| `GET` | `/checkout/sessions/:id` | Public | Get session display data; used by hosted payment page |
| `POST` | `/checkout/sessions/:id/pay` | Public | Process card payment; returns `redirectUrl` |
| `DELETE` | `/checkout/sessions/:id` | JWT | Cancel session |

**POST `/checkout/sessions` request:**
```json
{
  "merchantAgreementInstanceReference": "uuid",
  "amount": 99.00,
  "currency": "USD",
  "description": "Order #1234",
  "returnUrl": "https://merchant.com/success",
  "cancelUrl": "https://merchant.com/cancel",
  "merchantReference": "ORDER-1234"
}
```

**POST `/checkout/sessions` response (201):**
```json
{
  "checkoutSessionInstanceReference": "uuid",
  "paymentPageUrl": "http://localhost:3000/checkout/{id}",
  "expiresAt": "2026-06-10T12:30:00Z"
}
```

**POST `/checkout/sessions/:id/pay` request:**
```json
{
  "cardToken": "tok_abc123...",
  "cardholderName": "Jane Smith",
  "cardExpiryMonth": "12",
  "cardExpiryYear": "2027"
}
```

**POST `/checkout/sessions/:id/pay` response (200):**
```json
{
  "success": true,
  "cardTransactionInstanceReference": "uuid",
  "redirectUrl": "https://merchant.com/success?status=success&session={id}"
}
```

Error codes: 404 not found, 409 already completed, 410 expired/cancelled.

#### Payment Links (Method B) — prefix `/payment-links`

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/payment-links` | JWT | Create shareable payment link |
| `GET` | `/payment-links` | JWT | List links for a merchant |
| `GET` | `/payment-links/:code` | Public | Resolve link by 8-char code |
| `POST` | `/payment-links/:code/pay` | Public | Process card payment |
| `PATCH` | `/payment-links/:id` | JWT | Deactivate link |

**POST `/payment-links` request:**
```json
{
  "merchantAgreementInstanceReference": "uuid",
  "amount": 49.99,
  "currency": "USD",
  "description": "Consulting Session",
  "customerMessage": "Thank you for booking!",
  "usageType": "single_use"
}
```

**POST `/payment-links` response (201):**
```json
{
  "paymentLinkInstanceReference": "uuid",
  "paymentLinkCode": "ab3x7yzm",
  "paymentUrl": "http://localhost:3000/pay/ab3x7yzm"
}
```

Error codes: 404 merchant not found, 410 link expired/deactivated/completed.

#### Merchant Onboarding & Review — prefix `/merchants`

| Method | Route | Auth | Roles | Description |
|---|---|---|---|---|
| `POST` | `/merchants` | JWT | `customer` | Submit new merchant application (BIAN Action: Initiate). Sets status `under_review`. Initialises `merchantAgreementKybCheck.status = 'initiated'`. |
| `GET` | `/merchants/me` | JWT | `customer` | Return the merchant agreement owned by the caller's `partyRef`. Returns `{ found: false }` when none exists. Enables role-based state machine in frontend. |
| `GET` | `/merchants/:id` | JWT | `customer`, `merchant_officer`, `security_auditor` | Retrieve merchant agreement details. Response includes `merchantAgreementKybCheck` sub-document. |
| `GET` | `/merchants/:id/transactions` | JWT | owner (`partyRef` = `merchantOwnerPartyReference`), `merchant_officer`, `security_auditor` | Acquiring-side view (SD-89): payments the merchant **received**, newest first. Query: `page`, `limit`, `status`, `search` (case-insensitive on masked PAN / descriptor / merchant name). PCI DSS Req 3/7 — payer PII (account ref, email, raw gateway payload) is **never** returned; only masked PAN, amount, status, type, channel, descriptor, timestamp. Non-owner customers get 403. |
| `GET` | `/merchants/:id/stats` | JWT | owner, `merchant_officer`, `security_auditor` | Acquiring analytics (BIAN Merchant Activity Analysis): MongoDB aggregation returning totals, average ticket, breakdown by status, by currency, and operations per month. Aggregates only — no payer PII. Powers the merchant Overview dashboard. |
| `GET` | `/merchants/:id/events` | JWT | owner, `merchant_officer`, `security_auditor` | Merchant lifecycle **audit trail** (BIAN SD-89, PCI DSS Req 10): append-only `merchantAgreementEvents` log of `submitted` / `approved` / `rejected` / `updated` actions with actor and timestamp. Operational metadata only — no cardholder data. |
| `GET` | `/merchants` | JWT | `merchant_officer`, `security_auditor` | List all merchant applications (officer review queue) |
| `PATCH` | `/merchants/:id/review` | JWT | `merchant_officer`, `security_auditor` | Approve or reject application (BIAN Action: Control). Transitions status to `agreed` or `rejected`. Writes `merchantAgreementKybCheck` BQ:Step. |
| `POST` | `/merchants/:id/keys` | JWT | `customer` | Generate new API key (plaintext returned once; `keyOrigin: 'generated'`) |
| `POST` | `/merchants/:id/keys/import` | JWT | `customer` | Register an EXISTING key from the merchant's own system. Hashed server-side (bcrypt), plaintext never stored/returned; only the prefix is shown. `keyOrigin: 'imported'`. 400 if too short, 409 if already registered |
| `PATCH` | `/merchants/:id/keys/:keyId` | JWT | `customer` | Rename (relabel) a key — `{ label }`; empty label clears it. Label is never a secret |
| `DELETE` | `/merchants/:id/keys/:keyId` | JWT | `customer` | Revoke API key |

`MerchantApiKeyRecord` adds `keyOrigin?: 'generated' | 'imported'` (display only; absent = generated). Both generate and import store only the bcrypt hash + display prefix (PCI DSS Req 3).

**POST `/merchants` request (BIAN Action: Initiate):**
```json
{
  "merchantName": "Espresso Works Ltd",
  "merchantBusinessDescription": "Specialty coffee shop and online roastery",
  "merchantCategoryCode": "5814",
  "merchantLegalEntityType": "LLC",
  "merchantTaxId": "12-3456789",
  "merchantCountry": "US",
  "merchantExpectedMonthlyVolume": 15000,
  "merchantSettlementSchedule": "T+2",
  "merchantOwnerPartyReference": "PTY-001"
}
```

**POST `/merchants` response (201):**
```json
{
  "merchantAgreementInstanceReference": "uuid",
  "merchantAgreementStatus": "under_review",
  "message": "Application submitted. A Merchant Acquiring officer will review within 2 business days."
}
```

**PATCH `/merchants/:id/review` request (BIAN Action: Control):**
```json
{
  "action": "approve",
  "reviewNote": "KYB passed — business registered, tax ID verified, no adverse media"
}
```
or
```json
{
  "action": "reject",
  "reviewNote": "KYB failed — tax ID not found in business registry"
}
```

**PATCH `/merchants/:id/review` response (200):**
```json
{
  "merchantAgreementInstanceReference": "uuid",
  "merchantAgreementStatus": "agreed",
  "merchantReviewedDateTime": "2026-06-10T14:30:00Z",
  "merchantAgreementKybCheckStatus": "verified"
}
```

Status transitions: `approve` → `agreed` (KYB `verified`); `reject` → `rejected` (KYB `rejected`). Emits webhook event `merchant.agreement.activated` on approve.

Error codes: 404 merchant not found, 403 insufficient role, 400 invalid status transition.

#### Merchant Key Management — prefix `/merchants`

**POST `/merchants/:id/keys` response (201):**
```json
{
  "keyId": "uuid",
  "keyPrefix": "lbpk_live_ab",
  "merchantApiKey": "lbpk_live_<32hex>"
}
```

---

### 8.4 Seed Data Schema (Ch-05)

New seed files required for the merchant onboarding + debug mode features.

#### `backend/data/parties.json` — Additional Party records

| partyInstanceReference | partyName | partyType | Notes |
|---|---|---|---|
| `PTY-056` | `Rachel Torres` | `employee` | Merchant Acquiring officer — has `merchant_officer` auth role |
| `PTY-057` | `David Chen` | `customer` | Customer 2 — no merchant, simple cardholder |
| `PTY-058` | `Amara Okafor` | `customer` | Customer 3 — has a pending merchant application |
| `PTY-059` | `Lena Fischer` | `customer` | Customer 4 — dual-role (customer + active merchant) |

> Note: `partyType` must be one of the defined values: `'customer' | 'employee' | 'service_account'`. The value `'individual'` does not exist in the project model — it is a BIAN term, not a project-level enum value.

#### `backend/data/customerAuthentications.json` — Additional auth records

| login | role | linkedPartyRef | Notes |
|---|---|---|---|
| `officer@bank.demo` / `demo1234` | `merchant_officer` | `PTY-056` | Merchant Acquiring officer |
| `customer2@demo.com` / `demo1234` | `customer` | `PTY-057` | Simple customer, no merchant |
| `customer3@demo.com` / `demo1234` | `customer` | `PTY-058` | Customer with pending merchant app |
| `customer4@demo.com` / `demo1234` | `customer` | `PTY-059` | Dual-role customer + merchant |

#### `backend/data/merchants.json` — Demo merchant records (`schemaVersion: 2`)

| merchantName | status | kybCheckStatus | owner | Purpose |
|---|---|---|---|---|
| `Espresso Works Ltd` | `active` | `verified` | `PTY-001` | Dual-role demo — main customer also owns an active merchant |
| `Okafor Digital Services` | `under_review` | `initiated` | `PTY-058` | Pending approval — demonstrates review queue for `merchant_officer` |
| `Fischer Web Studio` | `active` | `verified` | `PTY-059` | Active merchant — customer4 owns this |

All merchant records include `merchantOwnerPartyReference`, `merchantCategoryCode`, `merchantLegalEntityReference`, `merchantSettlementSchedule`, and `merchantAgreementKybCheck` (Ch-06 BQ:Step).

#### `backend/data/customerAgreements.json` — KYC seed distribution (`schemaVersion: 3`)

| customerAgreementKycCheckStatus | Count | Notes |
|---|---|---|
| `verified` | 48 | Standard onboarded customers — KYC passed at enrollment |
| `expired` | 1 | `b0000049` — KYC completed >12 months ago with no renewal |
| `initiated` | 1 | `b0000050` — KYC in progress (onboarding not yet complete) |

All 50 records include `customerAgreementKycCheck` with BIAN BQ:Step sub-document (Ch-06).

---

### 8.5 PCI DSS + Security Notes

| Concern | Implementation |
|---|---|
| SAQ A scope | Card data entered only on `{FRONTEND_URL}/checkout/` and `{FRONTEND_URL}/pay/` — merchant domain never handles CHD |
| Card tokenization | Frontend generates `tok_<random>` surrogate; raw PAN never sent to backend API |
| API key storage | bcrypt hash only (`bcryptjs`, 10 rounds); plaintext returned once at generation, never stored |
| Webhook integrity | `X-Webhook-Signature: sha256=<hmac>` signed with per-merchant secret; constant-time comparison |
| Session TTL | MongoDB TTL index on `checkoutSessionExpiresAt` auto-deletes expired sessions after 30 min |
| Payment link codes | 8-char charset `[a-z2-9]` excluding ambiguous characters (O/0, I/l); unique index enforced |

---

### 8.6 Debug Mode Architecture

Debug Mode is a demo-only UX toggle that switches from the business narrative to a technical deep-dive view. It is protected by the environment variable `DEMO_DEBUG_ENABLED=true` (must be set; absent or `false` = hidden in production-like deployments).

**Client-side state:** `DebugContext` React context provider wraps the application layout. State persisted to `localStorage` key `demo_debug_mode`.

**Hook:** `useDebugMode(): { debugMode: boolean; toggleDebug: () => void; debugEnabled: boolean }`

**Components introduced in Ch-05:**

| Component | Purpose |
|---|---|
| `DebugBadge` | Chip showing BIAN Service Domain (e.g., `SD-89 · Merchant Relations`) and PCI DSS requirement |
| `DebugInfo` | Expandable info panel on action buttons — shows BIAN Action Term, HTTP method, MongoDB op, PCI DSS control |
| `DebugRawDoc` | Raw MongoDB document viewer — fetches from `/api/v1/system/raw/:collection/:id`; shows encrypted fields as Binary hex |
| `DebugFieldLabel` | Field wrapper showing QE mode (`QE:equality`, `QE:none`, `unencrypted`) and PCI classification |

**When debug mode is ON:**
- Every entity card shows a `DebugBadge` with BIAN SD and collection name
- Every encrypted field has a lock icon tooltip: `"QE:equality — BSON Binary subtype 6 · PCI DSS Req 3.5.1"`
- Every action button has an `[ℹ]` icon expanding a `DebugInfo` panel
- Key entity pages (merchant, transaction, case, checkout) show a `DebugRawDoc` panel with live ciphertext
- Login screen shows all demo users as cards (role badge + click-to-fill)
- Forms show "Load test data" dropdowns with 2–3 realistic presets

**When debug mode is OFF:** Clean business UI with no technical annotations.

---

### 8.7 FRONTEND_URL Environment Variable

The `FRONTEND_URL` env var is used to construct hosted page URLs:
- `paymentPageUrl = ${FRONTEND_URL}/checkout/{sessionId}`
- `paymentUrl = ${FRONTEND_URL}/pay/{linkCode}`

Defaults to `http://localhost:3000` when not set.

---

## 9. Integration Hub (SD-193) — API Contracts & Implementation

### 9.1 Integration Registry Routes (requires role: `system_admin`)

```
GET    /api/v1/integrations
       → 200 { integrations: IntegrationSummary[] }

POST   /api/v1/integrations
       body: { name, type, endpoint?, authScheme?, apiKey?, callbackEnabled, triggerEvents[], mode, timeoutMs?, retryPolicy? }
       → 201 { integration: ExternalProviderArrangement, apiKey?: string }   ← plaintext key ONCE

GET    /api/v1/integrations/:id
       → 200 { integration: ExternalProviderArrangement }                    ← no keyHash field

PATCH  /api/v1/integrations/:id
       body: { endpoint?, triggerEvents?, mode?, timeoutMs?, retryPolicy? }  ← no key update
       → 200 { integration: ExternalProviderArrangement }

POST   /api/v1/integrations/:id/rotate-key
       → 200 { integration: ExternalProviderArrangement, apiKey: string }    ← new key ONCE

POST   /api/v1/integrations/:id/test
       → 200 { status: 'ok'|'error', latencyMs: number, response?: object }

POST   /api/v1/integrations/:id/suspend
       body: {}
       → 200 { integration: ExternalProviderArrangement }  ← 400 if internal provider

GET    /api/v1/integrations/:id/events?page=1&limit=20
       → 200 { events: IntegrationEvent[], total: number, page: number }
```

**Role guard:** All routes require `X-Demo-Role: system_admin`. Returns 403 for any other role.

**Key management rules:**
- `externalProviderApiKeyHash` and `externalProviderCallbackSecretHash` are **never** returned in any API response.
- `externalProviderApiKeyPrefix` (first 12 chars of the plaintext key) is always returned for UI identification.
- Plaintext key is returned exactly once in the `apiKey` field of POST and POST /rotate-key responses.

### 9.2 Inbound Callback Routes (no JWT — HMAC validated)

All callbacks require `X-Webhook-Signature: sha256=<hmac-sha256-of-body>` header.

```
POST   /webhooks/fds/:arrangementId/callback
       body: { fraudScore: number, recommendation: string, caseId?: string, metadata?: object }
       → 200 { received: true }  |  401 (invalid signature)  |  404 (unknown arrangement)

POST   /webhooks/aml/:arrangementId/callback
       body: { alertType: string, severity: string, entities: string[], caseId?: string }
       → 200 { received: true }

POST   /webhooks/kyc/:arrangementId/callback
       body: { status: 'verified'|'rejected'|'expired', agreementRef: string, reference?: string }
       → 200 { received: true }

POST   /webhooks/kyb/:arrangementId/callback
       body: { status: 'verified'|'rejected'|'expired', merchantRef: string, reference?: string }
       → 200 { received: true }

POST   /webhooks/hrp/:arrangementId/callback
       body: { hrpcMatch: boolean, flags: string[], accountRef: string }
       → 200 { received: true }
```

### 9.3 Index Strategy

See §5 above for the full `integrationRegistry` and `integrationEvents` index definitions.

---

## 10. Stored Payment Card Management (SD-88) — customer card-on-file

Customer-managed card-on-file (view / add / remove). Aligns with BIAN SD-88 (Payment Card) and
PCI DSS Req 3 (no PAN/CVV stored; only masked PAN + QE:none expiry + surrogate token), Req 7
(least privilege / ownership), Req 10 (audit of lifecycle).

### 10.1 API contracts (`/api/v1/customer/:customerId/cards`)
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/v1/customer/:customerId/cards` | owner (customer) **or** L1/L2/auditor (read) | Lists non-revoked cards; masked PAN + network + status + surrogate token + alias + registration date. Sorted preferred-first. Expiry (QE:none) NOT returned. |
| GET | `/api/v1/customer/:customerId/cards/:cardId` | **owner only** | Self-service detail: surrogate token, expiry (QE:none, **owner-visible**), lifecycle dates, status, mandate, alias/note. Emits `card.accessed`. |
| POST | `/api/v1/customer/:customerId/cards` | owner only | Registers a card (token + expiry + masked PAN + network + optional alias). **No CVV accepted.** Emits `card.registered`. |
| PATCH | `/api/v1/customer/:customerId/cards/:cardId` | owner only | Edits the **only** mutable attributes — `paymentCardAlias` (≤40) and `paymentCardCustomerNote` (≤280). Emits `card.updated`. |
| PATCH | `/api/v1/customer/:customerId/cards/:cardId/status` | owner only | Deactivate/reactivate (`active`↔`suspended`). A suspended card stays on file but is declined by the PSP. Emits `card.deactivated`/`card.reactivated`. |
| DELETE | `/api/v1/customer/:customerId/cards/:cardId` | owner only | Soft-delete: `paymentCardStatus='revoked'`, mandate `cancelled`; record retained. Emits `card.removed`. |

### 10.1.1 Tokenization, activation control & auto-registration
- **Registration (client-side tokenization).** `POST` never receives the PAN or CVV. The browser
  (`frontend/src/lib/cardTokenize.ts`) validates the PAN (Luhn + network), expiry (future MM/YY) and
  CVV (3, or 4 for AMEX), then derives the masked PAN + a surrogate token and sends only those. The
  **CVV (SAD) is validated and discarded — never transmitted or stored** at any layer (PCI DSS Req 3.2).
  UI: `/system/cards/new`.
- **Deactivation = PSP-level decline.** A `suspended` card is retained (never physically deleted) but
  the PSP **declines every authorization** with it regardless of the issuer's decision. Enforced at two
  points via `getCardByToken`: the gateway authorizer (`authorizeCard`, BIAN SD-15 — response code
  `0540`, provider `psp-policy`, *before* any issuer/provider call) and the app-mode transaction path
  (`createTransaction` throws `CardNotActiveError` → HTTP 422). `revoked` (removed) cards are likewise
  declined. New/unsaved tokens have no card-on-file and pass through. Only `active`↔`suspended` are
  customer-toggleable; `expired`/issuer-`blocked`/`revoked` are not.
- **Auto-registration on every payment (any source).** `createTransaction` is the single chokepoint
  for all payment flows — app-mode, hosted checkout, payment links, the simulator, and any external
  system integrating with the PSP. It **unconditionally** calls `upsertCardByToken` (idempotent) for
  the resolved customer, so **using a card to pay IS the registration** — there is no "save card"
  opt-in (the old `saveCard` flag is gone). Expiry/network are stored when the source reports them
  (`paymentCardExpirationDate` + `paymentCardNetwork`, both optional); otherwise the card is still
  registered (masked PAN + surrogate token) and the customer can complete the details later. Cards
  with no resolvable owner (token-only, no customer) are not registered. The `/system/payment` picker
  shows at most 4 active cards (default first, auto-selected) plus a search/autocomplete for the rest.
- **Optional card fields.** `paymentCardNetwork` and `paymentCardExpirationDate` are optional on the
  model and in `CreateCardInput` to support externally-originated registrations; the list/detail
  responses omit them when absent and the UI shows a neutral fallback.

- **Ownership** is enforced server-side: the caller's JWT `partyRef` must resolve to a
  `customerAgreement` whose `customerAgreementInstanceReference` equals `:customerId`
  (`getOwnAgreementId`). All read/detail/update/delete are additionally scoped by `customerRef` in
  the query filter (defense in depth). The auth middleware carves the own-card path out of the
  customer block (`CUSTOMER_OWN_CARD_PATH`, which also matches `/cards/:cardId`).
- **Editable attributes:** only `paymentCardAlias` (nickname) and `paymentCardCustomerNote` are
  customer-editable — non-CHD display metadata (BIAN SD-88 presentation attributes). The PAN, token,
  expiry, network and status are immutable from the customer side. The alias/note MUST NOT contain a
  PAN/CVV (free-text labels only).
- **Surrogate token in the list:** `paymentCardReference` is returned in the list so the payment
  flow can pay with a saved card and so investigators can correlate transactions. It is **not CHD**
  under PCI DSS v4.0. The QE:none expiry stays out of the list (detail endpoint only).
- **Payment integration:** `/system/payment` step 1 lists the customer's **active** saved cards;
  selecting one reuses its surrogate token so the transaction references the real card-on-file.
- **Auto-save:** every payment auto-registers the card-on-file in `createTransaction` (see §10.1.1);
  there is no opt-in.
- **Step-up MFA:** production re-auth/TOTP plugs in at POST/PATCH/DELETE; the demo gates DELETE with
  an explicit client confirmation. CVV/PIN are never accepted or stored at any layer.

### 10.2 Model additions (BIAN SD-88)
`PaymentCardManagementControlRecord` (the **per-customer card-on-file arrangement**) adds optional
`paymentCardAlias`, `paymentCardCustomerNote` (non-CHD, customer-editable), `recordUpdatedDateTime`,
and makes `paymentCardNetwork` / `paymentCardExpirationDate` optional (external sources may omit them).

### 10.2.1 Physical-card registry + deterministic token + shared-card signal (ADR-027)
- **Deterministic token.** The browser derives the surrogate token as a keyed HMAC-SHA256 of the PAN
  (`deriveCardToken`), so the same PAN → the same token. PCI: irreversible (keyed), not a bare hash.
  Production tokenizes server-side / in a vault; the demo key is a `NEXT_PUBLIC` stand-in.
  **Every payment surface uses it** — wallet add (`/system/cards/new`), wallet payment
  (`/system/payment`), hosted checkout (`/gateway/checkout`), payment link (`/gateway/pay`) and the
  simulator. This is what makes dedup work end-to-end: paying repeatedly with the same card (any
  channel) always yields the same token, so the registry/arrangement never duplicates it. (Earlier,
  these flows minted a *random* token per payment, which created a new card-on-file each time.)
- **Two entities (no duplicated card).** `paymentCardManagement` = per-customer arrangement (unique
  compound index `(customerAgreementInstanceReference, paymentCardReference)` — a customer can't hold a
  card twice). **`paymentCardRegistry`** (new, plaintext, token unique) = the physical card, with
  `cardHolderAgreementReferences[]` + `cardHolderCount`. The card is stored once; the registry counts
  distinct holders. `syncCardRegistry` recomputes on register/auto-register/revoke; crossing
  `SHARED_CARD_HOLDER_THRESHOLD` (3) emits `card.shared.threshold.exceeded`.
- **Dedup.** POST → `registerCardForCustomer` (re-adding returns the existing arrangement with
  `reused:true`; a removed card reactivates). Auto-register → `upsertCardByToken`, scoped by
  `(customer, token)`.
- **FDS/AML surfaces.** Customer card detail returns `cardHolderCount` (number only). Investigation
  (L1/L2/auditor): `GET /api/v1/customer/card-registry/:token` → holders + count; transaction detail
  shows a shared-card indicator. Auditor Data Integrity (`/api/v1/fraud/integrity` → `cards`):
  duplicate arrangements, inconsistent tokenization (same masked card under multiple tokens), registry
  drift.

### 10.3 Audit
Lifecycle actions emit a **compliance** event (`complianceProcessEvent`) with
`processType: 'card_management'`, `entityType: 'card'`,
`processAction: 'card.registered' | 'card.accessed' | 'card.updated' | 'card.deactivated' | 'card.reactivated' | 'card.removed'`,
`performedByPartyReference`/`performedByRole` from the JWT. Visible in the unified audit
(`/system/audit-events`). `eventSummary` carries masked PAN + network only (no CHD).

### 10.4 Seed data
`backend/data/paymentCards.json` provides 3–4 cards per real `customerAgreement` (generator:
`backend/bin/generateCards.mjs`): valid future expiry (`MM/YY`), masked PAN, surrogate token,
unique alias per customer, one preferred card each, with a few non-active (expired/blocked) for
list-filter realism.

### 10.5 Frontend
- `/system/cards` — list with search (nickname / last-4), network + status filters, pagination
  (`Pagination`), rows link to detail. Customer-only (own section, not part of the profile).
- `/system/cards/[cardId]` — owner self-service detail: token, expiry, dates, status; inline edit
  of alias/note; remove (soft-delete with confirm). Technical labels (QE/token) only in debug mode.

*Added 2026-06-13; detail/edit/seed/payment-integration extension same day (doc + code together per repo rules).*
