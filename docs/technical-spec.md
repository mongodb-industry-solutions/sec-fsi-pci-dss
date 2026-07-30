# Technical Specification

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-07-01

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
  partyMobilePhoneNumber?: string;       // QE:equality — secondary investigation search key (optional: self-registered parties may omit it)
  partyMobilePhoneNumberDigest?: string; // Blind index (keyed HMAC, NOT encrypted) — unique key for the phone (absent when no phone; partial unique index)
  partyName: string;                     // v27: QE:substring (DEK-party-name) — "contains" search over ciphertext
  partyType: PartyType;
  partyDateOfBirth?: Date;               // v27: BSON Date, QE:range (DEK-party-dob) — was ISO string / QE:none
  partyNationality?: string;             // v27: QE:equality contention 8 (DEK-party-nationality). ISO 3166-1 alpha-2
  partyPlaceOfBirth?: string;            // v27: QE:equality contention 8 (DEK-party-place-of-birth) — city
  partySex?: PartySex;                   // QE:equality contention 8 (DEK-party-sex). GDPR PII. 'male'|'female'|'other'|'unspecified'
  partyPostalAddress?: PartyPostalAddress; // SD-13 postal contact point — GDPR PII, QE:none (DEK-party-address, L2 only)
                                         // KYC-typical demographics apply to EVERY party (customer + employee),
                                         // so staff profiles are as complete as customers'. Address + DOB are
                                         // encrypted at rest and decrypted only for the L2 client / the party themselves.
  bianServiceDomain: 'Party Data Management';
  bianControlRecordType: 'Party';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type PartyType = 'customer' | 'employee' | 'service_account';
export type PartySex = 'male' | 'female' | 'other' | 'unspecified';
```

> **Blind index for phone uniqueness.** `partyMobilePhoneNumber` is a QE:equality field, and
> MongoDB Queryable Encryption **cannot enforce a unique index on an encrypted field**. To
> guarantee that a phone number identifies exactly one party, we store `partyMobilePhoneNumberDigest`
> — a keyed HMAC-SHA256 of the *normalized* phone (leading `+` preserved, all other non-digits
> stripped), keyed by the blind-index key — in plaintext and put a **unique index** on it. The
> key is resolved in order: `PSP_BLIND_INDEX_KEY` if set; otherwise an HKDF-SHA256 subkey derived
> from `KMS_LOCAL_MASTER_KEY` (the QE master key is never reused verbatim — domain separation);
> otherwise a dev-only default. Whichever source is active must stay stable (changing it invalidates
> all digests → re-seed/backfill). The
> HMAC is irreversible without the key, so indexing it in the clear leaks nothing. The digest is
> derived server-side (`digest.ts` → `phoneDigest`) on seed and on any phone update; clients never
> set it. The same pattern applies to any other encrypted field that must be unique (e.g. email).

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
  customerAuthenticationAccountStatus: 'active' | 'suspended' | 'pending'; // pending = self-registered, awaiting manager approval (cannot log in)
  customerAuthenticationLastLoginDateTime?: Date;
  customerAuthenticationSessionEpoch?: number;        // Session validity counter; logout increments it to invalidate outstanding JWTs. Absent = epoch 0.
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
  customerAgreementKycCheckNotes?: string;      // @deprecated v27 — replaced by structured verdicts
  // v27 provider (HRP) verdicts, structured + auditable. Nested scalar leaves (parent sub-doc plaintext):
  customerAgreementKycCheckRiskScore?: number;                        // QE:range int 0-100 (DEK-kyc-risk-score)
  customerAgreementKycCheckRiskRating?: 'low' | 'medium' | 'high';    // QE:equality c8 (DEK-kyc-risk-rating)
  customerAgreementKycCheckPepStatus?: boolean;                       // QE:equality c8 (DEK-kyc-pep-status)
  customerAgreementKycCheckSanctionsResult?: 'clear' | 'hit' | 'pending'; // QE:equality c8 (DEK-kyc-sanctions-result)
  customerAgreementKycCheckScreeningProviderRef?: string;             // QE:none L2 (DEK-kyc-screening-ref)
}

// v27: structured government ID (SD-53). Parent sub-doc plaintext; leaves QE-encrypted.
export interface GovernmentID {
  type: string;              // QE:equality c6 (DEK-ca-govid-type)
  number: string;            // QE:suffix (DEK-ca-govid-number)
  issuingCountry: string;    // QE:equality c6 (DEK-ca-govid-issuing-country); ISO 3166-1 alpha-2
  expiryDate: Date;          // QE:range (DEK-ca-govid-expiry)
}

export interface CustomerAgreementControlRecord {
  customerAgreementInstanceReference: string;         // PK, UUID
  partyInstanceReference: string;                     // FK to party (SD-13)

  // QE:equality — direct search key
  customerAgreementReference: string;

  // QE:none (DEK-sensitive tier) — returned as Binary by L1 client; decrypted by L2
  customerAgreementResidentialAddress?: ResidentialAddress;
  governmentIdentificationReference?: string;  // @deprecated v27, LEGACY READ-ONLY since v32 (ADR-050):
                                               // never written (removed from the seeder and fixtures) and never
                                               // returned by any response. Use customerAgreementGovernmentID,
                                               // the single source of truth and the only searchable one.
  customerAgreementRiskNotes?: string;         // @deprecated v27 — use structured KYC verdicts

  // v27 KYC identity (user-supplied). Structured gov ID leaves are QE-searchable (see GovernmentID).
  customerAgreementGovernmentID?: GovernmentID;
  customerAgreementTaxIDNumber?: string;           // QE:prefix (DEK-ca-tax-id)
  customerAgreementOccupation?: string;            // QE:equality c6 (DEK-ca-occupation)
  customerAgreementSourceOfFunds?: string;         // QE:none L2 (DEK-ca-source-of-funds)
  customerAgreementPurposeOfRelationship?: string; // QE:none L2 (DEK-ca-purpose)

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

  merchantAgreementInstanceReference?: string;        // Acquiring-side FK → SD-89 (plaintext, indexed)

  // v18 (A-06): merchant commission captured at RUNTIME on a merchant-attributed acquiring payment.
  // feeAmount is the numeric source of truth; `fee` (= PaymentExecutionFee shape) records who the
  // commission is attributed to and how it was derived. Set ONCE at authorization (idempotent).
  // NOT CHD → NOT QE-encrypted. Aggregated into the merchant dashboard commissionRevenue (SD-89).
  feeAmount?: number;
  fee?: PaymentExecutionFee;                          // { feeMerchantReference, feeRateApplied, feeCollectedDateTime }

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
  partyAuthenticationDomainSelfRegistrationEnabled?: boolean;   // Local domains: show a Register link on login (absent = off)
  partyAuthenticationDomainSelfRegistrationAutoApprove?: boolean; // If self-reg on: create accounts active (skip manager approval). Gates login only, NOT KYC.
  partyAuthenticationDomainConfiguration: Record<string, unknown>; // Provider-specific config
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'AuthenticationDomain';
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
```

**Collection:** `authenticationDomain` — plaintext, no QE (domain config contains no CHD or PII).
**Seed file:** `backend/data/authDomains.json` — 3 pre-seeded domains: `local` (enabled), `msentra` (disabled), `bigid` (disabled).
**API:** `GET /api/v1/auth/domains` (public) — returns only domains with `partyAuthenticationDomainEnabled: true` (each item includes `selfRegistration` for local domains).

**Self-registration (local domains).** When `partyAuthenticationDomainSelfRegistrationEnabled` is true, the login screen shows a Register link and `POST /api/v1/auth/register` (public) accepts `{ name, email, password, phone?, domain }`. The account is always created with role `customer` (server-enforced, never client-selectable) and a linked SD-13 party (name/email, plus phone when given). Status is `active` when the domain auto-approves, otherwise `pending`; a manager approves (`pending → active`) or rejects (`→ suspended`) it from the domain's Users panel. Non-active accounts are blocked at login with a 403. Registration is orchestrated by `registerSelfServiceUser` (service, not controller) which publishes a `auth.register` compliance event (EDA, PCI DSS Req 10; no PII in the event summary). This gates login only and does NOT perform or imply KYC (a separate process).

**User admin API (SD-91, manager-only, `authDomains` permission):** `GET /api/v1/users`, `GET /api/v1/users/:id` (full detail incl. masked phone from the party), `POST /api/v1/users`, `PUT /api/v1/users/:id` (name/role/status/password/phone; phone is written to the SD-13 party and is unique), `DELETE /api/v1/users/:id`.

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

  // v18 (SD-16 audit attribution) — optional, backwards-compatible. Set when an action originates from
  // a merchant OAuth request (request.merchantContext). Powers the "user × merchant × action" activity
  // view without a new collection. Session (non-OAuth) actions leave these unset.
  clientId?: string;                    // OAuth client_id that originated the action
  merchantAgreementReference?: string;  // SD-89 merchant the action was performed through
  actingPartyReference?: string;        // party of the acting user (token sub)
  actingChannel?: 'session' | 'oauth_merchant';
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

**Resources** (→ BIAN SD): `transactions`(SD-254) · `customers`(SD-53) · `cards`(SD-88) · `accounts`(SD-66) · `fraudCases`(SD-83) · `merchants`(SD-89) · `providers`(SD-193) · `modules`(ADR-029) · `authDomains`(SD-16) · `roles` · `auditEvents`(ADR-025) · `consents`.
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
| **operations_officer** | — | — | view·manage | — | — | view | view·manage | — | — | view | — |
| **manager** | **—** | **—** | **—** | **—** | — | view·manage | view | view·manage | view·manage | view | — |

> The `operations_officer` (v29, BIAN SD-88 PaymentCardManagement + SD-66 PayoutAccountArrangement, department "Operations") also holds **`accounts: view·manage`** (SD-66; the `accounts` resource is not a column above). It is the global back-office administrator of the card inventory and payout accounts exposed by the built-in modules (§6.13). Scope `all`; permissions `cards:[view,manage]`, `accounts:[view,manage]`, `modules:[view,manage]`, `providers:[view]`, `auditEvents:[view]`. Via `modules:[view,manage]` it is the sole role that **manages** the configuration and policies of **all internal modules** (fds, aml, hrp, kyc, kyb, credit-bureau, card-authorization, card-issuer, account-information, payment-initiation, vop). `providers:[view]` is **read-only**: its administration landing shows which provider serves each capability (internal vs external / `managed_externally`), but provider CRUD stays with `manager`. This reflects the confirmed role philosophy: **`operations_officer` owns internal business logic and financial processes** (cards SD-88, accounts SD-66, the internal engines FDS/AML/HRP/card-issuer/AIS/PISP, audit, plus read-only provider visibility), whereas **`manager` owns system and platform** (integrations/providers, auth domains, roles, general config, security), never business or cardholder data. By separation of duties (PCI DSS Req 7) it is **distinct from `manager`**: `operations_officer` has **no** `providers:manage`, `authDomains` or `roles`; auth (SD-16, resource `authDomains`) stays exclusive to `manager`; `modules` no longer overlaps at the `manage` level (only `manager` retains `modules:view` for system/security oversight, editing of module config is exclusive to `operations_officer`). It is also distinct from `customer` (scope `own`, self-service).

> The `manager` (SD-193 platform admin) has **no** access to business/cardholder data — separation of duties (PCI Req 7). `can('manager','transactions','view') === false` ⇒ **403 backend** (`requirePermission` preHandler) + **`<AccessDenied>` frontend** (`<RequirePermission>`), with the role's responsibilities rendered from the live ACL. As of v29.2 the `manager` relation to `modules` is **read-only** (`modules:view`), for system and security oversight; editing internal module config/policies is exclusive to `operations_officer`.

**Enforcement & API:** `requirePermission(resource, action)` (Fastify preHandler, default-deny, cached role load + builtin fallback). `GET /api/v1/acl/effective` returns the caller's resolved permissions (frontend `can()` — permissions never live in the JWT). Roles CRUD: `GET/POST /api/v1/roles`, `GET/PUT/DELETE /api/v1/roles/:roleName` (`roles:manage`; builtin not deletable). Users (local): `GET/POST /api/v1/users`, `PUT/DELETE /api/v1/users/:id` (`authDomains:manage`). Remote role mappings: `partyAuthenticationDomainRoleMappings` on `authenticationDomain` (claim/group → role).

---

### 1.16 Customer Questions (ADR-031, SD-83)

Structured investigator→customer questions on a fraud case, answered by the customer on the related transaction; **immutable once answered** (PCI DSS Req 10).

**Collection `fraudDiagnosisCustomerQuestion`** (plaintext, no CHD) — `{ customerQuestionInstanceReference (PK), fraudDiagnosisInstanceReference, fraudDiagnosisCaseReference, cardTransactionInstanceReference, customerAgreementInstanceReference, partyInstanceReference, questionText, questionOptions[], allowOther, questionStatus('pending'|'closed'), askedBy{InstanceReference,Name,Role}, askedDateTime, responseOption?, responseText?, respondedByInstanceReference?, respondedDateTime?, bianServiceDomain, bianControlRecordType, recordCreated/UpdatedDateTime, schemaVersion }`. Indexes: unique `customerQuestionInstanceReference`; `cardTransactionInstanceReference`; `{fraudDiagnosisInstanceReference, askedDateTime}`; `{partyInstanceReference, questionStatus}`.

**API:**
- `POST /api/v1/fraud/:id/questions` (L1/L2) — body `{ questionText, options[], allowOther }`; creates a pending question on the case.
- `GET /api/v1/fraud/:id/questions` (investigation roles) — list questions + responses.
- `GET /api/v1/transactions/:id/questions` (`transactions:view`; customers scoped to own party) — customer-facing list.
- `POST /api/v1/transactions/:id/questions/:questionId/response` — customer answers `{ option, text? }`; atomic pending→closed (immutable; 409 if already closed; 403 if not the owner; 400 if the option is not valid / "Other" without text).
- `GET /api/v1/notifications` — the caller's pending questions (drives the menu badge).

**Events (Req 10):** create/answer emit `businessProcessEvent` (`fraud.question.created` / `fraud.question.answered`) and append `fraudDiagnosisCaseEvents` (`question_created` / `question_answered`). No CHD is ever stored in the question or response.

---

### 1.17 PSP Payout Orchestration Models (v17 — SD-54/65/66)

Three new collections added in v17 to support the end-to-end payout pipeline.

---

#### `payoutAccountArrangement` (SD-66 — Payment Initiation)

PSP-internal bank account record for each party. IBAN and routing number are encrypted at rest with `QE:none` (PCI DSS Req 3.3). Balance sub-document is updated atomically via `$inc`.

```typescript
// backend/src/modules/gateway/models/payoutAccount.model.ts
export const PAYOUT_ACCOUNT_COLLECTION = 'payoutAccountArrangement';

export type PayoutAccountType   = 'bank_account' | 'wallet' | 'internal_ledger';
export type PayoutAccountStatus = 'active' | 'pending_validation' | 'suspended' | 'closed';
export type PayoutRail          = 'sepa' | 'ach' | 'local_bank' | 'internal_wallet' | 'internal_ledger';

export interface PayoutAccountBalance {
  pendingAmount:   number;   // authorized, awaiting settlement
  availableAmount: number;   // settled funds available for withdrawal
  reservedAmount:  number;   // held for disputes / chargebacks
  currency:        string;   // ISO 4217 — must match payoutAccountCurrency
  lastUpdatedDateTime: Date;
}

export interface PayoutAccountArrangement {
  payoutAccountInstanceReference: string;  // UUID, PK
  partyInstanceReference:         string;  // FK → party (SD-13)

  payoutAccountType:         PayoutAccountType;
  payoutAccountStatus:       PayoutAccountStatus;
  payoutAccountIsDefault:    boolean;  // at most one true per party (partial unique index)

  // QE:none (DEK-payout-iban / DEK-payout-routing) — L1 returns Binary; L2 auto-decrypts
  payoutAccountIban?:          string;  // IBAN — GDPR Art. 32 / PSD2 (bank data, not PCI-scoped card data)
  payoutAccountRoutingNumber?: string;  // BIC / SWIFT / sort code — GDPR Art. 32 / PSD2

  payoutAccountAlias?:          string;  // phone or email alias for lookup
  payoutAccountBankName?:       string;
  payoutAccountHolderName?:        string;  // account holder legal name (from party) — SD-66 (max 140)
  payoutAccountBicSwift?:          string;  // ISO 9362 BIC/SWIFT: /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/ (8 or 11 chars)
  payoutAccountCorrespondentBic?:  string;  // correspondent bank BIC for international wires (8 or 11 chars, same pattern)
  payoutAccountBankAddress?:       string;  // bank branch/HQ address (max 200)
  payoutAccountCurrency:        string;  // ISO 4217
  payoutAccountCountryCode:     string;  // ISO 3166-1 alpha-2
  payoutAccountPreferredRail:   PayoutRail;

  payoutAccountBalance: PayoutAccountBalance;  // PSP internal ledger — $inc only

  bianServiceDomain:      'Payment Initiation';
  bianControlRecordType:  'PayoutAccountArrangement';
  recordCreatedDateTime:  Date;
  recordUpdatedDateTime:  Date;
  schemaVersion:          number;
}
```

---

#### `paymentExecutionProcedure` (SD-65 — Payment Execution)

Lifecycle record for each payout. Created after card authorization; tracks the full journey from beneficiary resolution to final settlement. `resolutionLog` is append-only (PCI DSS Req 10).

```typescript
// backend/src/modules/gateway/models/paymentExecution.model.ts
export const PAYMENT_EXECUTION_COLLECTION = 'paymentExecutionProcedure';

export type PaymentExecutionStatus =
  | 'pending'     // created, not yet routed
  | 'routing'     // beneficiary resolution in progress
  | 'scheduled'   // destination resolved; waiting for T+N window
  | 'in_flight'   // funds dispatched to payout rail
  | 'completed'   // settlement confirmed
  | 'failed'      // terminal failure
  | 'exception'   // blocked: no eligible destination; manual review required
  | 'refunded'    // reversed post-settlement
  | 'reversed';   // rolled back before settlement

export interface PaymentExecutionResolutionStep {
  stepName:    string;
  stepOutcome: 'found' | 'not_found' | 'fallback' | 'failed';
  stepNote?:   string;
  stepDateTime: Date;
}

export interface PaymentExecutionProcedure {
  paymentExecutionInstanceReference:  string;   // UUID, PK
  paymentOrderInstanceReference:      string;   // FK → paymentOrderProcedure (SD-64)
  cardTransactionInstanceReference?:  string;   // FK → cardTransactionLog (SD-254)

  beneficiaryType:               BeneficiaryType;  // 'merchant' | 'user' | 'anonymous'
  beneficiaryPartyReference?:    string;            // FK → party (SD-13) for user payouts
  beneficiaryArrangementReference?: string;         // FK → counterpartyArrangement (SD-54) — links the detail page to the saved beneficiary
  resolvedPayoutAccountReference?: string;          // FK → payoutAccountArrangement (SD-66)
  // v18 (SD-89): the merchant that INITIATED this execution via the merchant portal (OAuth on-behalf-of).
  // Set only for merchant-originated transfers; PSP-direct customer transfers leave it unset. Enables
  // merchant data isolation on GET /transactions (OAuth channel: a merchant sees only its own activity
  // for the user, never other merchants' or direct-PSP activity). NOT CHD → NOT QE-encrypted.
  merchantAgreementReference?: string;              // FK → merchantAgreementInstanceReference (SD-89)

  // Recipient identity for a bank transfer to an UNREGISTERED external account (SEPA/ACH/SWIFT).
  // Bank data under GDPR Art. 32 / PSD2 (NOT PCI DSS — that governs card data). destinationIban is
  // QE:none (DEK-exec-dest-iban), encrypted at rest and shown full to the account owner; the masked
  // form is plaintext for list views. Registered destinations link via the FKs above instead.
  beneficiaryName?:          string;   // holder legal name as entered at initiation
  destinationIban?:          string;   // full destination IBAN — QE:none (L2 only)
  destinationAccountMasked?: string;   // masked IBAN / account, e.g. "ES12••••5477"
  destinationCountry?:       string;   // ISO 3166-1 alpha-2 destination banking country

  grossAmount: number;
  netAmount:   number;
  feeAmount:   number;  // commission/processing amount (numeric source of truth)
  // v18 (SD-65 attribution / SD-89 pricing): merchant-commission ATTRIBUTION only. The numeric amount
  // stays in feeAmount above (do NOT duplicate it). Records who the fee belongs to and how it was
  // derived so the merchant dashboard aggregates commissionRevenue. NOT CHD → NOT QE-encrypted.
  fee?: {
    feeMerchantReference: string;   // FK → merchantAgreementInstanceReference (SD-89)
    feeRateApplied:       number;   // commission rate 0..1 applied at capture
    feeCollectedDateTime: Date;     // when the commission was collected
  };
  currency:    string;  // ISO 4217

  paymentExecutionRail?: PayoutRail;
  routingNote?:          string;
  paymentExecutionRemittanceInformation?: string; // ISO 20022 RemittanceInformation — payment concept/reference (bank transfer / P2P note); first-class + queryable for AML/FDS. Not CHD → NOT QE.

  paymentExecutionStatus: PaymentExecutionStatus;
  failureReason?:  string;
  scheduledAt?:    Date;
  initiatedAt?:    Date;
  completedAt?:    Date;

  resolutionLog: PaymentExecutionResolutionStep[];  // append-only, never cleared

  bianServiceDomain:     'Payment Execution';
  bianControlRecordType: 'PaymentExecutionProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion:         number;
}
```

---

#### `counterpartyArrangement` (SD-54 — Counterparty Administration)

Beneficiary registry entry. Raw phone/email is **never stored** — only the resolved `partyInstanceReference` and a masked display hint. The opaque `counterpartyArrangementReference` is the "beneficiary token" shared with merchants for payment initiation.

```typescript
// backend/src/modules/identity/models/counterpartyArrangement.model.ts
export const COUNTERPARTY_COLLECTION = 'counterpartyArrangement';

// Max beneficiaries per user — configurable via PSP_BENEFICIARY_MAX_PER_USER (default: 100)
export const COUNTERPARTY_MAX_PER_USER = config.payout.beneficiaryMaxPerUser;

export type CounterpartyArrangementStatus = 'active' | 'removed';
export type CounterpartyLookupType        = 'phone' | 'email';

export interface CounterpartyArrangement {
  counterpartyArrangementReference: string;  // UUID v4 — the opaque beneficiary token
  ownerPartyReference:              string;  // FK → party: who owns this contact
  counterpartyPartyReference:       string;  // FK → party: the resolved beneficiary (PSP internal)

  counterpartyLabel:       string;                  // owner-defined or masked hint
  counterpartyLookupType:  CounterpartyLookupType;
  counterpartyLookupHint:  string;                  // masked at store: "+34 6** *** 789" / "j***@example.com"
                                                     // NEVER stores raw phone/email

  counterpartyArrangementStatus: CounterpartyArrangementStatus;

  bianServiceDomain:     'Counterparty Administration';
  bianControlRecordType: 'CounterpartyArrangement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion:         number;
}
```

*Added 2026-07-01 (v17). Code and doc travel together per SDD rule.*

---

## 2. QE encryptedFieldsMaps

All maps live in `backend/src/vendors/encryption/encryptedFieldsMaps.ts`. The `keyId` values are per-field BSON Binary UUIDs resolved at runtime from the provisioned DEKs via `provisionDEKs.ts`.

**DEK naming (as of v3 BIAN compliance update):**

| DEK key | Atlas key vault name | Protects |
|---|---|---|
| `deks.partyEmail` | `DEK-party-email` | `party.partyEmailAddress` |
| `deks.partyPhone` | `DEK-party-phone` | `party.partyMobilePhoneNumber` |
| `deks.partyAddress` | `DEK-party-address` | `party.partyPostalAddress` (QE:none — GDPR PII, L2 only) |
| `deks.partyDob` | `DEK-party-dob` | `party.partyDateOfBirth` (QE:none — GDPR PII, L2 only) |
| `deks.authEmail` | `DEK-auth-email` | `customerAuthenticationAssessment.customerAuthenticationEmailAddress` |
| `deks.customerAccountRef` | `DEK-customer-account-ref` | `customerAgreementProcedure.customerAgreementReference` |
| `deks.txAccountRef` | `DEK-tx-account-ref` | `cardTransactionLog.cardTransactionAccountReference` |
| `deks.customerAddress` | `DEK-customer-address` | `customerAgreementProcedure.customerAgreementResidentialAddress` (QE:none, inline v2) |
| `deks.customerGovId` | `DEK-customer-gov-id` | `customerAgreementProcedure.governmentIdentificationReference` (QE:none, inline v2). v32: legacy. The field is no longer written or read; the DEK stays so documents seeded before v32 remain decryptable. |
| `deks.customerRiskNotes` | `DEK-customer-risk-notes` | `customerAgreementProcedure.customerAgreementRiskNotes` (QE:none, inline v2) |
| `deks.txRawPayload` | `DEK-tx-raw-payload` | `cardTransactionLog.rawGatewayPayload` (QE:none, inline v2) |
| `deks.txProcessorMeta` | `DEK-tx-processor-meta` | `cardTransactionLog.processorTransactionMetadata` (QE:none, inline v2) |
| `deks.cardExpiry` | `DEK-card-expiry` | `paymentCardManagement.paymentCardExpirationDate` |
| `deks.payoutIban` | `DEK-payout-iban` | `payoutAccountArrangement.payoutAccountIban` (QE:none — GDPR Art. 32 / PSD2) |
| `deks.payoutRouting` | `DEK-payout-routing` | `payoutAccountArrangement.payoutAccountRoutingNumber` (QE:none — GDPR Art. 32 / PSD2) |
| `deks.execDestIban` | `DEK-exec-dest-iban` | `paymentExecutionProcedure.destinationIban` — unregistered external destination (QE:none — GDPR Art. 32 / PSD2) |
| `deks.partyName` | `DEK-party-name` | `party.partyName` (v27, QE:substring — lookup tier) |
| `deks.partyNationality` | `DEK-party-nationality` | `party.partyNationality` (v27, QE:equality c8) |
| `deks.partyPlaceOfBirth` | `DEK-party-place-of-birth` | `party.partyPlaceOfBirth` (v27, QE:equality c8) |
| `deks.partySex` | `DEK-party-sex` | `party.partySex` (QE:equality c8, GDPR PII) |
| `deks.caGovIdNumber` | `DEK-ca-govid-number` | `customerAgreementGovernmentID.number` (v27, QE:suffix) |
| `deks.caGovIdType` | `DEK-ca-govid-type` | `customerAgreementGovernmentID.type` (v27, QE:equality c6) |
| `deks.caGovIdIssuingCountry` | `DEK-ca-govid-issuing-country` | `customerAgreementGovernmentID.issuingCountry` (v27, QE:equality c6) |
| `deks.caGovIdExpiry` | `DEK-ca-govid-expiry` | `customerAgreementGovernmentID.expiryDate` (v27, QE:range date) |
| `deks.caTaxId` | `DEK-ca-tax-id` | `customerAgreementTaxIDNumber` (v27, QE:prefix) |
| `deks.caOccupation` | `DEK-ca-occupation` | `customerAgreementOccupation` (v27, QE:equality c6) |
| `deks.kycRiskScore` | `DEK-kyc-risk-score` | `customerAgreementKycCheck.customerAgreementKycCheckRiskScore` (v27, QE:range int) |
| `deks.kycRiskRating` | `DEK-kyc-risk-rating` | `...customerAgreementKycCheckRiskRating` (v27, QE:equality c8) |
| `deks.kycPepStatus` | `DEK-kyc-pep-status` | `...customerAgreementKycCheckPepStatus` (v27, QE:equality c8) |
| `deks.kycSanctionsResult` | `DEK-kyc-sanctions-result` | `...customerAgreementKycCheckSanctionsResult` (v27, QE:equality c8) |
| `deks.caSourceOfFunds` | `DEK-ca-source-of-funds` | `customerAgreementSourceOfFunds` (v27, QE:none L2) |
| `deks.caPurpose` | `DEK-ca-purpose` | `customerAgreementPurposeOfRelationship` (v27, QE:none L2) |
| `deks.kycScreeningRef` | `DEK-kyc-screening-ref` | `...customerAgreementKycCheckScreeningProviderRef` (v27, QE:none L2) |

> **Regulatory note:** IBAN / routing / BIC are **bank account data → GDPR Art. 32 + PSD2**, not PCI DSS. PCI DSS scope is card data (PAN / CHD). Both are QE-encrypted at rest here, but for distinct regulatory drivers.

### 2.1 v27 — QE search showcase (equality / range / substring / prefix / suffix)

v27 adds searchable KYC fields to demonstrate every QE query type over encrypted GDPR PII (never
card data). These fields are **lookup-tier** (present in both L1 and L2 maps), so L1 analysts can
search and decrypt them. `QE:none` v27 fields (source of funds, purpose, screening provider ref)
stay L2-only. `partyName` moves from plaintext to `QE:substring`; `partyDateOfBirth` changes from
an ISO string (`QE:none`) to a **BSON Date** with `QE:range`. Auth fields
(`partyEmailAddress`, `partyMobilePhoneNumber`) are unchanged `QE:equality` (one query type per
field; auth depends on equality).

**Text-search gating.** `buildEncryptedFieldsMaps(deks, tier, textSearch = config.qe.textSearch)`.
Text-search query types are single-sourced as constants: `QT_SUBSTRING = 'substringPreview'`,
`QT_PREFIX = 'prefixPreview'`, `QT_SUFFIX = 'suffixPreview'` (MongoDB 8.2 preview /
mongodb-client-encryption 7.2). Env var `PSP_QE_TEXT_SEARCH=false` degrades all text fields to
`QE:equality` (contention 8) so setup never fails on pre-8.2 clusters while keeping the fields
encrypted, lookup-tier and exact-searchable.

| Field | bsonType | Query type | Params |
|---|---|---|---|
| `party.partyName` | string | substring | strMaxLength 30, strMinQueryLength 3, strMaxQueryLength 10, caseSensitive false, diacriticSensitive false (sized within cluster default substringPreview limits) |
| `party.partyDateOfBirth` | date | range | min 1900-01-01, max 2020-01-01, sparsity 1, trimFactor 4 |
| `party.partyNationality` | string | equality | contention 8 |
| `party.partyPlaceOfBirth` | string | equality | contention 8 |
| `party.partySex` | string | equality | contention 8 |
| `customerAgreementGovernmentID.number` | string | suffix | strMaxLength 20, strMinQueryLength 3, strMaxQueryLength 10, caseSensitive true, diacriticSensitive true |
| `customerAgreementGovernmentID.type` | string | equality | contention 6 |
| `customerAgreementGovernmentID.issuingCountry` | string | equality | contention 6 |
| `customerAgreementGovernmentID.expiryDate` | date | range | min 2000-01-01, max 2040-01-01, sparsity 1, trimFactor 4 |
| `customerAgreementTaxIDNumber` | string | prefix | strMaxLength 20, strMinQueryLength 2, strMaxQueryLength 10, caseSensitive true, diacriticSensitive true |
| `customerAgreementOccupation` | string | equality | contention 6 |
| `customerAgreementKycCheck.customerAgreementKycCheckRiskScore` | int | range | min 0, max 100, sparsity 1, trimFactor 4 |
| `customerAgreementKycCheck.customerAgreementKycCheckRiskRating` | string | equality | contention 8 |
| `customerAgreementKycCheck.customerAgreementKycCheckPepStatus` | bool | equality | contention 8 |
| `customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult` | string | equality | contention 8 |
| `customerAgreementSourceOfFunds` / `customerAgreementPurposeOfRelationship` / `...ScreeningProviderRef` | string | none (L2) | not searchable, retrieval only |

> **Query window + in-memory refinement.** `strMaxQueryLength` (10) caps what the encrypted index
> can match, but an operator holding a **full** value (e.g. the 11-character government ID
> `ES123454821`) must still find the record. The registry therefore carries two limits per text
> field: `maxQueryLength` (the QE window) and `inputMaxLength` (what the operator may type, sized to
> `strMaxLength`). A longer value is never truncated: `textQueryWindow()` sends the longest slice that
> cannot lose a match (last N characters for suffix, first N for prefix and substring), so the
> encrypted query returns a **superset**, and `buildTextRefiner()` re-applies the full predicate over
> the already-decrypted value to narrow it to an exact answer. The refinement mirrors the index
> `caseSensitive` / `diacriticSensitive` params (declared on the field def) and runs server-side only;
> Atlas still receives ciphertext and only the window. Refining discards candidates, so the encrypted
> query reads a bounded wider page (`limit * 5`, capped at 200) to still fill one result page.
> Raising `strMaxQueryLength` above 10 instead would need the
> `fleDisableSubstringPreviewParameterLimits` server parameter plus a full drop and reseed, which is
> why the window is refined rather than widened.

> **Nested QE paths.** Encrypting `customerAgreementGovernmentID.number` and
> `customerAgreementKycCheck.*` is allowed because each parent sub-document stays plaintext; only
> the scalar leaves are QE fields, each with its own unique DEK.

**Role gate (least-privilege, PCI DSS Req 7).** The multi-result KYC attribute search
(`GET /api/v1/customer/search/fields`, `POST /api/v1/customer/search`) is a discovery capability
that returns lists, so it is restricted server-side to `level2_investigator` and `security_auditor`
(`KYC_SEARCH_ROLES` / `canRunKycSearch`); unauthorized roles get 403. Level 1 analysts keep only the
blind single-record lookup (`GET /api/v1/customer?email|phone|accountRef`) and cannot enumerate the
customer base by attribute. In the UI the search lives as an "Advanced search" section on
`/system/users`, rendered only for L2/auditor; the shared `EncryptedKycSearch` component is reused in
the demo simulator. Sensitive `QE:none` result fields remain gated by escalation (L2 token) / auditor.

**Result/query correspondence (UI contract).** `EncryptedKycSearch` auto-searches on a 450 ms debounce,
so several QE queries of very different cost can overlap. Each request carries an `AbortSignal` and a
sequence number, and only the newest one may write state, so a slow earlier response can never
overwrite the rows of the query on screen. Rows are rendered only while the query that produced them
still matches the active one (`committedKey`); otherwise the surface shows the searching state. Text
inputs are capped at `inputMaxLength`, never at the QE window, and when the value exceeds the window
the UI states which slice MongoDB is queried with. Empty results are phrased with the field's mode
("No government ID no. ends with …"), because a directional match returning nothing is an answer, not
a failure. A **Clear filters** action resets the value, the range bounds and the results, and aborts
the in-flight query. The result list carries only identifying columns (name, government ID, agreement
reference, status, email), progressively hidden below `lg` / `md`; segment, phone and the `QE:none`
fields (address, risk notes) belong to the customer detail, where the disclosure is audited.

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
        // GDPR PII — QE:none, Level 2 only (postal address + date of birth)
        ...(includeSensitive ? [
          { keyId: deks.partyAddress, path: 'partyPostalAddress', bsonType: 'object' },
          { keyId: deks.partyDob,     path: 'partyDateOfBirth',   bsonType: 'string' },
        ] : []),
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

    // ── payoutAccountArrangement (SD-66) ──────────────────────────────
    // QE:none only — IBAN and routing number are sensitive bank data at rest (GDPR Art. 32 / PSD2)
    // but NOT searchable (accounts looked up by payoutAccountInstanceReference, not IBAN).
    // L1 map omits this block → driver returns Binary. L2 map includes it → auto-decrypts.
    ...(includeSensitive ? {
      payoutAccountArrangement: {
        fields: [
          { keyId: deks.payoutIban,    path: 'payoutAccountIban',          bsonType: 'string' },
          { keyId: deks.payoutRouting, path: 'payoutAccountRoutingNumber',  bsonType: 'string' },
        ],
      },
    } : {}),

    // ── paymentExecutionProcedure (SD-65) ─────────────────────────────
    // destinationIban = full IBAN of an UNREGISTERED external transfer destination the user typed.
    // QE:none (GDPR Art. 32 / PSD2), L2 only. Registered destinations link via FK instead of storing IBAN.
    ...(includeSensitive ? {
      paymentExecutionProcedure: {
        fields: [
          { keyId: deks.execDestIban, path: 'destinationIban', bsonType: 'string' },
        ],
      },
    } : {}),
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
    const key = process.env.KMS_LOCAL_MASTER_KEY;
    if (!key) throw new Error('KMS_LOCAL_MASTER_KEY is required when KMS_PROVIDER=local');
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
    // Uniqueness on the (encrypted) phone is enforced via its blind-index digest instead.
    // Partial: phone is optional (self-registered parties may omit it), so only documents that
    // carry a digest participate in the uniqueness constraint.
    { key: { partyMobilePhoneNumberDigest: 1 }, unique: true, partialFilterExpression: { partyMobilePhoneNumberDigest: { $exists: true } } },
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
    // v27: plaintext helper on the KYC lifecycle status. NOT a QE field.
    { key: { 'customerAgreementKycCheck.customerAgreementKycCheckStatus': 1 } },
  ]);

  // Note: customerAgreementProcedureSensitive collection removed in v2 (fields inline)
  // v27: the QE-encrypted KYC leaves (riskScore, riskRating, pepStatus, sanctionsResult,
  // govID.number/type/issuingCountry/expiryDate, taxID, occupation, partyName, partyDateOfBirth)
  // are searched via QE queries only. They take NO btree indexes and NO unique index
  // (QE fields cannot be unique — use the blind-index HMAC pattern if uniqueness is ever needed).

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
    // v18 (A-06): runtime merchant commission revenue aggregation (SD-89 dashboard). Sparse.
    { key: { 'fee.feeMerchantReference': 1, 'fee.feeCollectedDateTime': -1 }, sparse: true },
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
    // v18: "user × merchant × action" activity view (SD-16). Sparse — only OAuth-attributed events.
    { key: { merchantAgreementReference: 1, actingPartyReference: 1, eventDateTime: -1 }, sparse: true },
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

**v17 index additions** (`createIndexes.ts`):

```typescript
// ── payoutAccountArrangement (SD-66) ────────────────────────────────────────
await ensureIndexes(db, 'payoutAccountArrangement', [
  { key: { payoutAccountInstanceReference: 1 }, unique: true },
  { key: { partyInstanceReference: 1, payoutAccountStatus: 1 } },
  // Partial unique: only one default per party. Filter avoids false conflicts with non-default.
  {
    key:    { partyInstanceReference: 1, payoutAccountIsDefault: 1 },
    unique: true,
    partialFilterExpression: { payoutAccountIsDefault: true },
  },
]);

// ── paymentExecutionProcedure (SD-65) ───────────────────────────────────────
await ensureIndexes(db, 'paymentExecutionProcedure', [
  { key: { paymentExecutionInstanceReference: 1 }, unique: true },
  { key: { paymentOrderInstanceReference: 1 } },
  { key: { cardTransactionInstanceReference: 1 } },
  { key: { paymentExecutionStatus: 1, recordCreatedDateTime: -1 } },
  // v18: commission revenue aggregation (SD-89 dashboard). Sparse — only fee-bearing executions.
  { key: { 'fee.feeMerchantReference': 1, 'fee.feeCollectedDateTime': -1 }, sparse: true },
  // v18: merchant-scoped transaction history (SD-89 data isolation). Sparse — only merchant-initiated execs.
  { key: { merchantAgreementReference: 1, initiatorPartyReference: 1 }, sparse: true },
]);

// ── counterpartyArrangement (SD-54) ─────────────────────────────────────────
await ensureIndexes(db, 'counterpartyArrangement', [
  { key: { counterpartyArrangementReference: 1 }, unique: true },
  { key: { ownerPartyReference: 1, counterpartyArrangementStatus: 1 } },
  // Unique (owner, counterparty) pair — prevents duplicate beneficiary entries.
  { key: { ownerPartyReference: 1, counterpartyPartyReference: 1 }, unique: true },
]);
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
  "cardToken": "pm_abc123",
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

**Response 200** (the projection is `buildResponse()`; it is the contract, and the route schema must stay `additionalProperties: true` or the serializer silently strips fields):
```json
{
  "customerAgreementInstanceReference": "...",
  "partyInstanceReference": "...",
  "customerName": "John Doe",
  "customerEmailAddress": "john@example.com",
  "customerMobilePhoneNumber": "+34-600-000-000",
  "customerAgreementReference": "ACC-001",
  "customerSegment": "retail",
  "customerAgreementStatus": "active",
  "customerAgreementGovernmentID": {
    "type": "driver_license", "number": "GB31454621", "issuingCountry": "GB", "expiryDate": "2031-12-24"
  },
  "customerAgreementTaxIDNumber": "ES12345678",
  "customerAgreementOccupation": "engineer",
  "contactPiiRestricted": false,
  "sensitiveAvailable": true
}
```

**Tiering (v32, plan §4.1).**
- **Lookup tier**, returned to every role that can reach the record so a displayed value is always a searchable value: the identity document (`customerAgreementGovernmentID`: `.number` QE:suffix, `.type`/`.issuingCountry` QE:equality, `.expiryDate` QE:range), `customerAgreementTaxIDNumber` (QE:prefix) and `customerAgreementOccupation` (QE:equality).
- **Contact PII** (`customerEmailAddress`, `customerMobilePhoneNumber`) is restricted to `level2_investigator` and `security_auditor`; `contactPiiRestricted: true` tells the client why it is absent.
- **Sensitive tier** (QE:none: `customerAgreementResidentialAddress`, `customerAgreementRiskNotes`) travels in a `sensitive` block **only** on the audited escalation path (a case reference, which is what emits `field_accessed`). Otherwise the response carries `sensitiveAvailable: true` and the value must be obtained from `GET /customer/:partyRef/kyc/reveal`, which emits one `kyc.sensitive.revealed` event per disclosure (PCI DSS Req 10.2.2). ADR-052.
- `governmentIdentificationReference` is **not** part of any response since v32 (ADR-050).

> The encrypted search keys are also echoed back only under the tiering above; they are primarily used as search predicates.

---

### 6.3 Cards — `module: customer` (SD-88)

> Base path: `/api/v1/customer/:customerId/cards` — cards as sub-resource of Customer Agreement (SD-53)

#### `GET /customer/me/cards`

Returns the **authenticated caller's own** saved cards (SD-88), resolved server-side from the JWT (`request.user.partyRef` → own agreement via `getOwnAgreementId`). Takes **no id** from the client, so it cannot be used to read another party's cards. Used by the hosted checkout and payment-link pages to offer the *viewer's* saved cards, gated purely on the browser's PSP session token (never the session/link's stored acting party — that would leak the creator's cards on a shared link).

**Response 200** (display-safe only — surrogate token + masked PAN; never full PAN, CVV or expiry):
```json
{ "results": [
  { "paymentCardInstanceReference": "...", "cardToken": "pm_...", "paymentCardMaskedPanDisplay": "****-****-****-1234", "paymentCardNetwork": "VISA", "paymentCardAlias": "Personal", "paymentCardIsPreferred": true }
] }
```
A caller with no customer agreement (e.g. staff) receives `{ "results": [] }`.

#### `POST /customer/:customerId/cards`

Registers a tokenized card linked to a customer agreement.

**Request body** (`customerAgreementInstanceReference` is taken from the `:customerId` path param — do not include it in the body):
```json
{
  "cardToken": "pm_abc123",
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

**Client-side resume (`useCaseEscalation`).** The token lives in `sessionStorage` under `esc:<caseId>`,
which is per tab, so a deep link into a case, its transaction or its customer opened in a new tab
arrives without it and the server correctly returns no sensitive data. Every page that renders
sensitive case data uses the shared `frontend/src/lib/useCaseEscalation.ts` hook: it reuses the token
from this tab and, failing that, re-derives it for a `level2_investigator` when the case is
`escalated` **and** already has `escalationAcceptedAt`. Re-deriving calls this same endpoint, which
is idempotent for an accepted escalation, so it adds no audit noise and never approves an escalation
that was not accepted (the 422 above keeps it fail-closed). It runs at most once per case per mount,
and while it runs the UI shows a pending state rather than "restricted", which would misreport the
operator's access.

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
    "sub": "uuid-v4",
    "customerAuthenticationInstanceReference": "uuid-v4",
    "name": "Sarah Chen",
    "email": "sarah.chen@back.es",
    "role": "level1_analyst"
  }
}
```

> `sub` is the canonical OIDC subject claim (equal to `customerAuthenticationInstanceReference`, retained for back-compat). The OAuth consent flow reads `user.sub` as the `_psp_sub` identity carried through `/auth/authorize`.

> The JWT also carries an `epoch` claim: the value of `customerAuthenticationSessionEpoch` (default 0) at sign time. See `POST /auth/logout` for how it enables stateless server-side invalidation.

#### `POST /auth/logout`

Server-side logout for the session JWT. The PSP session token is a stateless HS256 JWT, so it cannot be individually revoked without a token store. Instead, logout advances the caller's `customerAuthenticationSessionEpoch` (SD-91). Every issued JWT stamps the epoch current at sign time; the auth middleware reads the user's current epoch on each authenticated request and rejects any token whose stamped `epoch` is behind. This invalidates **all** of that user's outstanding tokens at once, storing no token (neither valid nor revoked).

- **Auth:** requires a valid session JWT (behind the global middleware).
- **Effect:** `$inc` of `customerAuthenticationSessionEpoch` for the caller's `sub`.
- **Response 200:** `{ "loggedOut": true }`
- **Client:** the frontend calls this before clearing its `demo_token` cookie. The merchant (relying party) triggers it via front-channel single sign-out: its logout redirects the browser through the PSP `/auth/logout` page, which calls this endpoint and clears the cookie same-origin. This closes the gap where a hosted checkout kept recognising a "logged-in" payer (and surfacing their saved cards) after the payer logged out of the merchant.
- **Failure posture:** the middleware epoch check fails **open** on a DB error (a transient outage must not lock out every user); production could fail closed.

**Response 401:** `{ "error": "Invalid credentials" }`

---

#### `GET /system/users`

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

Used by the "Encrypted in Atlas" toggle in both modes. Enabled by default; set `PSP_DEMO_RAW_DOCUMENTS=false` to remove the surface (403).

#### `GET /api/v1/system/raw/:collection/:id`

Returns the raw BSON document as stored in Atlas (ciphertext visible, no auto-decryption). Uses a plain MongoClient without `autoEncryption`.

**Authorization (v32 C5).** JWT alone is not sufficient. `RAW_COLLECTION_RESOURCE` maps each allowed collection to the BIAN resource that owns it, and it is the single source of truth for both the allowed list and the check:

| Collection | Owning resource |
|---|---|
| `party`, `customerAgreementProcedure`, `customerAuthenticationAssessment` | `customers` |
| `cardTransactionLog` | `transactions` |
| `paymentCardManagement` | `cards` |
| `fraudDiagnosisCase` | `fraudCases` |

- Roles with scope `all` (staff) need `view` on the owning resource.
- Roles with scope `own` (`customer`) are authorized by **ownership** instead: the data subject reaches its own record (GDPR Art. 15) without holding the staff-facing permissions. Ownership is resolved server-side from the caller's identity (own party reference, own `sub`, own agreement, and an L1-client probe for a transaction / card / case), never from a request parameter.
- The kill-switch may only remove the surface, never grant access to it (P6 / ADR-051).

**Path params:** `collection` (from the table above), `id` (primary key `*InstanceReference`)

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

**Response 400:** Unknown collection. **Response 403:** `PSP_DEMO_RAW_DOCUMENTS=false` (`code` absent), the role lacks `view` on the owning resource (`code: ACL_DENIED`), or the document belongs to another party (`code: OWNERSHIP_DENIED`).

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

### 6.10 Payout Accounts — `module: accounts` (SD-66 · v17)

> Base path: `/api/v1/accounts`  
> Auth: Bearer JWT  
> Scope: customers can only access their own `partyRef`; `security_auditor` / `manager` can view all.

#### `GET /accounts/:partyRef`

Lists payout accounts for a party.

**Query:** `status` (filter), `page` (default 1), `limit` (default 20, max 100)

**Response 200:**
```json
{
  "results": [
    {
      "payoutAccountInstanceReference": "acct-uuid",
      "partyInstanceReference": "party-uuid",
      "payoutAccountType": "bank_account",
      "payoutAccountStatus": "active",
      "payoutAccountIsDefault": true,
      "payoutAccountAlias": "My Savings",
      "payoutAccountBankName": "Demo Bank",
      "payoutAccountCurrency": "EUR",
      "payoutAccountCountryCode": "ES",
      "payoutAccountPreferredRail": "sepa",
      "payoutAccountBalance": {
        "pendingAmount": 0, "availableAmount": 1250.00, "reservedAmount": 0,
        "currency": "EUR", "lastUpdatedDateTime": "2026-07-01T10:00:00Z"
      },
      "recordCreatedDateTime": "2026-01-15T08:00:00Z"
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

Note: `payoutAccountIban` and `payoutAccountRoutingNumber` are **never returned to L1 clients** — they remain as BSON Binary ciphertext and are stripped by `safeAccount()`.

#### `POST /accounts/:partyRef`

Registers a new payout account. Requires `accounts:manage`.

**Body:**
```json
{
  "payoutAccountType": "bank_account",
  "payoutAccountCurrency": "EUR",
  "payoutAccountCountryCode": "ES",
  "payoutAccountPreferredRail": "sepa",
  "payoutAccountAlias": "My Savings",
  "payoutAccountBankName": "Demo Bank",
  "payoutAccountIsDefault": true
}
```

**Response 201:** Created account document (IBAN/routing stripped).

#### `GET /accounts/:partyRef/:accountRef`

Returns a single payout account. Requires `accounts:view`.

#### `POST /accounts/:partyRef/:accountRef/default`

Sets the account as the party's default. Atomic: clears the prior default. Requires `accounts:manage`.

**Response 200:** `{ "payoutAccountInstanceReference": "...", "payoutAccountIsDefault": true }`

#### `DELETE /accounts/:partyRef/:accountRef`

Closes a payout account (soft delete — status → `'closed'`). Requires `accounts:manage`.

**Response 200:** `{ "payoutAccountInstanceReference": "...", "payoutAccountStatus": "closed" }`

---

### 6.11 Payment Executions — `module: executions` (SD-65 · v17)

> Base path: `/api/v1/executions`  
> Auth: Bearer JWT  
> Roles: `level1_analyst`, `level2_investigator`, `security_auditor`, `manager`

#### `GET /executions`

Lists payment execution records with optional filters.

**Query:** `status`, `partyRef`, `from` (ISO date), `to` (ISO date), `page`, `limit`

**Response 200:**
```json
{
  "results": [
    {
      "paymentExecutionInstanceReference": "exec-uuid",
      "paymentOrderInstanceReference": "order-uuid",
      "cardTransactionInstanceReference": "txn-uuid",
      "beneficiaryType": "merchant",
      "resolvedPayoutAccountReference": "acct-uuid",
      "grossAmount": 99.99, "netAmount": 99.99, "feeAmount": 0,
      "currency": "EUR",
      "paymentExecutionRail": "sepa",
      "paymentExecutionStatus": "completed",
      "completedAt": "2026-07-01T11:00:00Z",
      "resolutionLog": [
        { "stepName": "ais.account.validation", "stepOutcome": "found", "stepDateTime": "..." },
        { "stepName": "pisp.transfer.initiated", "stepOutcome": "found", "stepDateTime": "..." },
        { "stepName": "bank.transfer.settled",   "stepOutcome": "found", "stepDateTime": "..." }
      ]
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

#### `GET /executions/:executionRef`

Returns a single execution by reference. Includes full `resolutionLog`.

---

### 6.12 Merchant Beneficiary API — SD-54

> **v32 (ADR-048): this is a SEARCH surface, not an enumeration surface.**
>
> `GET /api/v1/beneficiaries` (and `/:ownerRef`) requires a discriminating predicate for any
> non-own-scope caller: `ownerRef`, `caseRef`, or `q` of at least 3 characters. Without one the route
> returns **400** `{ error, code: 'PREDICATE_REQUIRED' }`. The rule is enforced in
> `assertBeneficiaryPredicate()` at the service boundary, so a future caller cannot bypass it.
>
> Capabilities: `beneficiaries:view` authorises a drill-down for a **known** owner party reference;
> `beneficiaries:investigate` is additionally required for a **cross-party** read (held by
> `level2_investigator` and `security_auditor`, not by `level1_analyst`). `security_auditor` holds no
> `manage` (read-only oversight, segregation of duties).
>
> Projection: the display-safe projection applies to **every** channel including the session one. A
> list response never contains `counterpartyPartyReference` or the raw lookup value. The counterparty
> identifier is masked by `maskLookupValue` *before* it is written, so the plaintext is not persisted
> and is unrecoverable by any role: there is deliberately no reveal endpoint for it.
>
> Audit: one `beneficiary.record.disclosed` compliance event per record returned, naming the owner
> party reference and which predicate was used (PCI DSS Req 10.2.2). `BusinessEntityType` gains
> `'beneficiary'` for this purpose.
>
> `GET /api/v1/beneficiaries/aggregates` returns `{ total, byStatus, byLookupType }` with **no
> identifiers**, so an oversight role can size the population without addressing a record. It emits no
> disclosure event because nothing is disclosed.



> **Superseded in v23.** The dedicated `/api/v1/merchant/beneficiaries/*` tree was removed. Merchant
> beneficiary operations now use the SHARED `/api/v1/beneficiaries` capability endpoints on the OAuth
> channel (owner derived from `token.sub`, never in the URL). See the **v23 dual-auth capability surface**
> table under §Granular consent for the full endpoint/scope mapping. Behavior (phone/email lookup with
> anti-enumeration, display-safe masked hints, server-side source-account resolution, `merchant.beneficiary.send`
> attribution) is unchanged; only the path and auth wiring moved.

Mapping from the removed routes to the shared surface:

| Removed (`/api/v1/merchant/...`) | Shared endpoint (v23) | Scope |
|---|---|---|
| `POST /beneficiaries/:partyRef/lookup` | `POST /beneficiaries` | `write:beneficiaries` |
| `GET /beneficiaries/:partyRef` | `GET /beneficiaries` | `read:beneficiaries` |
| `DELETE /beneficiaries/:partyRef/:beneficiaryToken` | `DELETE /beneficiaries/:beneficiaryRef` | `write:beneficiaries` |
| `POST /beneficiaries/:partyRef/:beneficiaryToken/send` | `POST /beneficiaries/:beneficiaryRef/transfer` | `write:transfers` |
| `GET /merchant/accounts/:partyRef` | `GET /accounts` | `read:accounts` |
| `GET /merchant/transactions/:partyRef` | `GET /transactions` | `read:transactions` |
| `POST /merchant/transfers/:partyRef/{preview,bank}` | `POST /gateway/transfers/{preview,bank}` | `write:transfers` |

---

### 6.13 Global resource administration (built-in modules, v29)

> Base paths: `/api/v1/modules/card-issuer` (Swagger tag `modules:card-issuer`) and
> `/api/v1/modules/account-information` (Swagger tag `modules:account-information`).
> Auth: Bearer JWT + `requirePermission('cards'|'accounts', 'view'|'manage')` (role `operations_officer`).
> These are **additive** administration surfaces owned by the built-in modules. They are a **distinct
> surface** from the existing self-service/party-scoped routes (`/api/v1/customer/:customerId/cards`, §6.3,
> and `/api/v1/accounts/:partyRef`, §6.10), which are unchanged. The self-service routes are scoped by
> party; these list and mutate the **whole** card inventory (SD-88) and payout-account book (SD-66).

**Capability gate (409 `managed_externally`).** Every route below runs the `requireInternalProvider`
preHandler (`capabilityGate.service.ts`). A built-in module is the internal fallback adapter of its
capability's provider group. If an external provider is the active winner of that group
(`externalProviderIsInternal !== true`, priority < 999), the whole administration surface responds
**409 Conflict** `{ "error": "managed_externally" }`. With only the internal provider active (priority
999) the routes operate normally. The 409 emits an application `warn` log, not a compliance event.

**Cards (built-in module `card-issuer`, SD-88)**

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/modules/card-issuer/cards` | `cards:view` | Global listing, paginated `{results,total,page,limit}`, filters `network`/`status`/`agreement`. Display-safe rows: surrogate token, **masked PAN**, network, status, agreement ref, dates. **No PAN/CVV; expiry NOT included** (data minimization). |
| `GET` | `/modules/card-issuer/cards/:cardId` | `cards:view` | Single card detail. **Reveals `paymentCardExpirationDate` (QE:none)** to `operations_officer` (see PCI note); 404 if absent. Emits `card.accessed` (Req 10). |
| `POST` | `/modules/card-issuer/cards` | `cards:manage` | Registers a card for `customerAgreementInstanceReference`; reuses `registerCardForCustomer`; schema rejects CVV/PIN. Emits `card.registered`. |
| `PATCH` | `/modules/card-issuer/cards/:cardId` | `cards:manage` | Updates metadata (alias/note); reuses `updateCardMetadata`. Emits `card.updated`. |
| `PATCH` | `/modules/card-issuer/cards/:cardId/status` | `cards:manage` | `{active}` activate/suspend; reuses `setCardActivation`. Emits `card.(de|re)activated`. |
| `DELETE` | `/modules/card-issuer/cards/:cardId` | `cards:manage` | Revoke (soft delete, record retained for audit); reuses `revokeCard`. Emits `card.removed`. `{removed:true}`. |

**Accounts (built-in module `account-information`, SD-66)**

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/modules/account-information/accounts` | `accounts:view` | Global listing, paginated `{results,total,page,limit}`, filters `status`/`party`/`currency`. Rows **QE-stripped** with hints `payoutAccountHasIban` / `payoutAccountHasRoutingNumber`. |
| `GET` | `/modules/account-information/accounts/:accountRef` | `accounts:view` | Single account detail (QE-stripped + hints); reuses `getPayoutAccount`. Emits `account.accessed`. |
| `POST` | `/modules/account-information/accounts` | `accounts:manage` | Registers an account for `partyInstanceReference`; IBAN/routing stored as QE ciphertext; reuses `createPayoutAccount`. Emits `account.created`. |
| `PATCH` | `/modules/account-information/accounts/:accountRef` | `accounts:manage` | Updates account metadata; reuses `updatePayoutAccount`. Emits `account.updated`. |
| `DELETE` | `/modules/account-information/accounts/:accountRef` | `accounts:manage` | Close (soft delete, status → `closed`); reuses `closePayoutAccount`. Emits `account.closed`. |

> **IBAN/routing** are never returned by these routes (QE ciphertext stripped by `safeAccount()`); the
> existing reveal endpoint and its roles are unchanged. **PAN** is always masked; **CVV/PIN** are never
> accepted nor stored.

**PCI decision (expiry in the card detail).** `paymentCardExpirationDate` (QE:none) is **revealed to
`operations_officer` in the card detail** (`GET .../cards/:cardId`, audited via `card.accessed`) but
**not in the listing** (minimization). Rationale: expiry is CHD but **not** Sensitive Authentication
Data (SAD); PCI DSS only mandates masking of the PAN (Req 3.3), not the expiry. Req 7 need-to-know is
satisfied by the dedicated role, and Req 10 by the per-access audit event. No deviation.

**Auditing (Req 10).** Every mutation emits exactly one compliance event (`card.*` / `account.*`) with
`performedByRole: operations_officer`, references and masked PAN / hints, never CHD in the clear. A
single-card/account detail read emits one `card.accessed` / `account.accessed`. Global listings emit
**no** per-row event; at most one aggregate event per call (`admin.cards.listed` / `admin.accounts.listed`
with `{count, filters}`), gated by `PSP_AUDIT_LIST_ACCESS` (default off, §7).

**Module configuration routes (v29.1).** The `GET/PUT /api/v1/modules/<cap>/config` routes of the 11
internal modules (fds, aml, hrp, kyc, kyb, credit-bureau, card-authorization, card-issuer,
account-information, payment-initiation, vop) previously had no backend guard; they are now protected with
`requirePermission('modules', 'view'|'manage')`. `PUT .../config` requires `modules:manage`, which as of
v29.2 only `operations_officer` holds (`manager` can no longer edit module config). `GET .../config`
requires `modules:view`: accessible by `operations_officer`, `manager` and `security_auditor`.

**Data model.** v29 introduced **no** schema or index changes: same collections (`paymentCardManagement`,
`paymentCardRegistry`, `payoutAccountArrangement`), fields, QE encryptedFields, DEKs and indexes as v17/v28.
The only additions are data-driven (ADR-030): the `operations_officer` builtin role and two demo users.
Global listings sort by `recordCreatedDateTime` (demo-scale collscan; no supporting index added).

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
LOCAL_MASTER_KEY=               # 96-byte hex (generated by `npm run setup:key:master`)
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
# PORT: defaults to 8081 in source; Dockerfile sets 8080 for K8s
PORT=8081
NODE_ENV=development
JWT_SECRET=                     # 32-char random string
PSP_URL_FRONTEND=http://localhost:8080
PSP_CORS_ORIGIN=http://localhost:8080

# ── Fraud detection ────────────────────────────────────────────────
FRAUD_AMOUNT_THRESHOLD=500
RISK_MCC_LIST=5812,6011,7995
ESCALATION_TOKEN_TTL_SECONDS=3600

# ── Payout Orchestration (v17 — PSP_ prefix) ───────────────────────
# All read via pspEnv('NAME', 'default') helper in backend/src/config.ts
PSP_BENEFICIARY_MAX_PER_USER=100          # Max beneficiaries per user (SD-54)
PSP_BENEFICIARY_RATE_LIMIT_RPM=20        # Max lookups/min per merchant+user pair
PSP_PAYOUT_SETTLEMENT_DELAY_T1_MS=3000  # Simulated T+1 delay in ms (builtin PISP)
PSP_PAYOUT_SETTLEMENT_DELAY_T2_MS=6000  # Simulated T+2 delay in ms
PSP_PAYOUT_SETTLEMENT_DELAY_T3_MS=9000  # Simulated T+3 delay in ms
PSP_PAYMENT_INITIATION_ALWAYS_SUCCEED=true  # Set false to simulate 5% rail failures
PSP_AIS_ALWAYS_VERIFY=true               # Set false for builtin AIS to return unverified
PSP_AUDIT_LIST_ACCESS=false              # v29: emit 1 aggregate compliance event per global admin listing (default off)

# ── Demo exposure switches ─────────────────────────────────────────
# "What does Atlas see?" raw-ciphertext view (GET /system/demo/raw/:collection/:id) bypasses QE
# auto-decryption. Enabled by default in EVERY environment (this is a demo system, and the view is
# the encryption story). Set to false to harden a deployment towards production-ready behaviour, or
# on any environment holding real cardholder data (PCI DSS Req. 7 / 10).
PSP_DEMO_RAW_DOCUMENTS=true
# Re-enables /admin/exec under NODE_ENV=production (arbitrary command execution; demo only).
PSP_ADMIN_ENFORCE=false

# ── Frontend demo convenience (NEXT_PUBLIC_, build-time) ───────────
# Kill-switch for the OIDC /auth/authorize demo shortcut. Two per-request query params drive it:
#   prefill_password=<pw>  → prefills the password field (login_hint prefills the email).
#   auto_login=1|true      → additionally submits the login automatically (needs both credentials).
# INSECURE by design (URLs leak passwords into history, proxy logs, Referer). ALLOWED by default in
# ANY environment; set this flag to 'false' to disable both params entirely and harden a deployment.
NEXT_PUBLIC_PSP_OIDC_AUTO=true
```

---

## 8. Seed Data Schema

Seed files live in `backend/data/`. The seed script (`backend/bin/seed.ts`) reads each file and performs upsert operations using the collection's primary key as the filter.

### Seed volumes

Counts are the v33 population.

| File | Collection (BIAN SD) | Documents | Generator |
|---|---|---|---|
| `backend/data/parties.json` | `party` (SD-13) | 68 (57 customers + 11 employees) | `bin/seed-generate.ts` (additive) |
| `backend/data/customerAuthentications.json` | `customerAuthenticationAssessment` (SD-91) | 68 (one per party; 14 `customerAuthenticationDemoFeatured`) | `bin/seed-generate.ts` (additive) |
| `backend/data/authDomains.json` | `authenticationDomain` (SD-16) | 3 | manual (the `local` domain ships with self-registration on, manual approval) |
| `backend/data/customerAgreements.json` | `customerAgreementProcedure` (SD-53) | 57 | `bin/seed-generate.ts` — includes inline QE:none fields (v2) |
| `backend/data/paymentCards.json` | `paymentCardManagement` (SD-88) | 205 | `bin/seed-generate.ts` (additive) |
| `backend/data/payoutAccounts.json` | `payoutAccountArrangement` (SD-66) | 65 | `bin/seed-generate.ts` (additive; curated records are never rewritten) |
| `backend/data/cardTransactions.json` | `cardTransactionLog` (SD-254) | 230 | `bin/seed-generate.ts` — includes inline QE:none fields (v2) |
| `backend/data/fraudCases.json` | `fraudDiagnosisCase` (SD-83) | 20 | `bin/seed-generate.ts` |
| `backend/data/fraudCaseEvents.json` | `fraudDiagnosisCaseEvents` (SD-83) | 20 | `bin/seed-generate.ts` |
| `backend/data/customerCreditRatings.json` | `customerCreditRatingState` (SD-60) | 5 | manual (HRPC profiles) |

**Regenerating synthetic data:** run `npm run generate:data --prefix backend` (executes `bin/seed-generate.ts`).

Since v33 (ADR-054) the generator is **additive and refuses to clobber**: it loads the existing
fixtures, keeps every curated record byte-for-byte, and only tops the synthetic population up to the
target floors (50 customer parties, 4 transactions per customer, 20 fraud cases). `write()` refuses to
reduce any collection's record count and exits non-zero unless `--force` is passed. A second run over
its own output changes nothing, so it is safe to run at any time. Manual files (`authDomains.json`,
`customerCreditRatings.json`, `merchants.json`) are never touched.

Set `PSP_SEED_DATA_DIR` to write to a different directory (the seeder reads the same variable). The
integrity test uses it to exercise the generator without touching the real fixtures.

### Fixture integrity invariants (v33)

The fixtures, not the runtime, are the source of truth for the demo population, so the invariants are
asserted against `backend/data/*.json` in `test/backend/unit/services/seedDataIntegrity.test.ts` and
`seedGeneratorAdditive.test.ts`. The shared repairs live in `backend/src/vendors/seed/dataIntegrity.ts`
and are applied by **both** halves of the pipeline (the generator and the runtime seeders), so neither
can drift from the other.

| Invariant | Enforced by |
|---|---|
| Every `customer` party has exactly one SD-91 login, identity taken from the party (SD-13 is the source of truth) | `deriveCustomerLogins`, called by the generator and by `seedUsers` |
| Every customer is complete: agreement with a KYC record, ≥1 card, ≥1 payout account, ≥1 transaction | `completeCustomerPopulation`, called by the generator |
| Every transaction points at a card held by the same party, masked PANs agreeing | `repointTransactionsToCards`, called by the generator and by `seedTransactions` |
| A fraud case snapshot shows the masked PAN its transaction carries | `syncFraudCaseSnapshots` |
| Every card is funded by an active payout account owned by the same party | `seedCards` (relink pass) |

Deliberate exceptions, asserted rather than repaired:

- **A shared card token is not a duplicate.** One physical card (one token) held by several customers
  is the FDS/AML shared-card signal: the SD-88 arrangement is keyed by `(customerAgreementInstanceReference, paymentCardReference)`,
  which the unique compound index enforces, and the distinct-holder count is surfaced as
  `cardHolderCount`. There is deliberately **no** unique index on `paymentCardReference` alone.
- **A masked-PAN collision is realistic.** Different PANs legitimately share their last four digits.
- **One `initiated` KYC record** is an in-progress lifecycle state on an otherwise complete customer.
  It is what makes the KYC administration list's completed-subset count explainable (v32 Track E).

### Demo users (`data/customerAuthentications.json`)

Credentials are stored in `customerAuthenticationAssessment` (SD-91). Passwords stored as bcrypt hashes (12 rounds). Email is a QE:equality field. Plaintext passwords are in `.env.example` comments for demo convenience only.

| Email | Role | Display Name |
|---|---|---|
| `luis.fernandez@back.es` | `customer` | Luis Fernandez |
| `julia.santos@back.es` | `customer` | Julia Santos |
| `sarah.chen@back.es` | `level1_analyst` | Sarah Chen |
| `michael.obi@back.es` | `level2_investigator` | Michael Obi |
| `admin@back.es` | `security_auditor` | Admin |

Each of these users has a corresponding `party` document in `parties.json` linked via `partyInstanceReference`.

Since v33 **every** party holds a login, not just the curated ones: 57 customers plus 11 staff. The
login picker still shows only the curated cast, selected by `customerAuthenticationDemoFeatured: true`
(14 records); every other customer is reachable through search and signs in with the same shared demo
credential. A customer with an agreement, cards, a payout account, transactions and a fraud case who
could not sign in was the single largest coherence gap in the demo (v33 F1).

### Synthetic data rules

- All personal data (names, emails, phones, addresses) is generated with `@faker-js/faker`
- Card tokens use the format `pm_<uuid>`: never a real card number
- `paymentCardMaskedPanDisplay` / `cardTransactionMaskedPanDisplay` format: `****-****-****-XXXX` where XXXX is a random 4-digit suffix
- `paymentCardExpirationDate` is always a future date (at least 12 months from generation)
- CVV, PIN, full PAN, and magnetic stripe data are **never included** in seed files
- Identity documents are the structured `customerAgreementGovernmentID` sub-document only, produced by
  `enrichKyc` (the single source, ADR-050). The deprecated flat `governmentIdentificationReference`
  and its `SYNTH-<8-digits>` values are gone from every fixture and from the generator (v33 F5); a test
  asserts neither string reappears
- Fraud cases attach to transactions that do not already carry one, up to the target of 20
- Records the generator derives (a login, a completing agreement/card/transaction) use references
  derived from their parent reference, so regenerating produces identical output rather than duplicates

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
│   └── seed-generate.ts            # synthetic data generator → writes backend/data/*.json
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
  // v18 on-behalf-of attribution (optional): who the merchant app acted for when it created the session,
  // so the resulting card transaction lands under the payer and the purchase is auditable. Identity refs
  // only — never CHD/PAN, never PII beyond the id.
  checkoutSessionActingSubjectReference?: string;  // SD-91 OAuth subject (customerAuthenticationInstanceReference)
  checkoutSessionActingPartyReference?: string;    // SD-13 partyInstanceReference (resolved from the subject)
  checkoutSessionActingClientId?: string;          // OAuth client_id of the acting merchant app
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

// v18 (SD-89 pricing): per-operation commission rate 0..1 (e.g. 0.025 = 2.5%). Editable from
// merchant settings (PATCH /merchants/:id, RBAC merchants:manage); the seeder only sets an initial
// default. Consumed by computeFee() to populate paymentExecution.feeAmount + fee attribution (SD-65).
merchantCommissionRate?: number;

// v18 (OIDC client metadata, RFC 7591) on MerchantOAuthClientConfig — branding on the consent/login
// page and the user's "Authorized Applications" listing. Validated as https on the OAuth-client PATCH.
// oauthLogoUri?: string;    // merchant logo/icon URL (OIDC logo_uri)
// oauthClientUri?: string;  // merchant home page URL (OIDC client_uri)

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
  "merchantReference": "ORDER-1234",
  "actingSubjectReference": "sub-of-logged-in-buyer"
}
```

`actingSubjectReference` (optional, v18): OAuth subject (SD-91 login id) of the user the merchant app is acting for. Attribution only, the charge stays merchant-authenticated (client_credentials); it lets the resulting purchase land in the payer payment history and the merchant operations view. Resolved server-side to the payer party and canonical account reference so `cardTransactionAccountReference` is the payer ACC (not the raw email or card token). Mirrors the API-payment path.

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
  "cardToken": "pm_abc123...",
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
| `GET` | `/merchants/:id/stats` | JWT | owner, `merchant_officer`, `security_auditor` | Acquiring analytics (BIAN Merchant Activity Analysis): MongoDB aggregation returning totals, average ticket, breakdown by status, by currency, and operations per month. **v18:** also returns `commissionRevenue { total, count, byMonth[] }` — the UNION of two fee-attribution sources filtered by `fee.feeMerchantReference`: seeded payout executions (`paymentExecutionProcedure.fee`, SD-65) **and** runtime acquiring card payments (`cardTransactionLog.fee`, SD-254, populated at authorization by A-06). No double-counting (a payment lives in exactly one source). Aggregates only — no payer PII. Powers the merchant Overview dashboard. |
| `PATCH` | `/merchants/:id` | JWT | owner (own merchant), `merchant_officer`, `security_auditor` | Partial update of operational settings. Owner-editable: `merchantAllowedCurrencies`, `merchantSettlementSchedule`, `merchantWebhookEndpoint`, `merchantDefaultPayoutAccountReference`, **v18** `merchantCommissionRate` (SD-89, number 0..1, max 4 decimals; validated; change audited via `merchant.commission_rate.updated` event). Risk-governed fields (`merchantTransactionLimitAmount`, `merchantAgreementStatus`) are PSP staff only. |
| `GET` | `/merchants/:id/events` | JWT | owner, `merchant_officer`, `security_auditor` | Merchant lifecycle **audit trail** (BIAN SD-89, PCI DSS Req 10): append-only `merchantAgreementEvents` log of `submitted` / `approved` / `rejected` / `updated` actions with actor and timestamp. Operational metadata only — no cardholder data. |
| `GET` | `/merchants/:id/activity` | JWT | owner, `merchant_officer`, `security_auditor`, `level1_analyst`, `level2_investigator` | **v18 (B-01/B-12) — activity view "user × merchant × action".** Reads `businessProcessEvent` where `merchantAgreementReference == :id` (OAuth-originated actions tagged in the activity attribution). Query filters: `user` (`actingPartyReference` exact), `q` (free text on `processAction` / `entityId` / `processType` / user), `dateFrom` / `dateTo` (ISO 8601), `page` / `limit`. Response `{ events[{ id, eventDateTime, processType, processAction, processOutcome, entityType, entityId, clientId, actingPartyReference, actingChannel, summary }], total, page, limit }`. **Display-safe** — never returns CHD or raw IBAN (PCI DSS Req 3/7 · Req 10). |
| `GET` | `/merchants/:id/authorizations` | JWT | owner, `merchant_officer`, `security_auditor`, `level1_analyst`, `level2_investigator` | **v18 (B-10) — users who authorized this merchant.** Reads `partyAuthConsent` filtered by `merchantAgreementInstanceReference` (SD-16 ConsentGrant), joined to the user's display-safe identity (SD-13). Query filters: `q` (search by user name / email / party ref), `page` / `limit`. Response `{ authorizations[{ consentId, partyAuthenticationInstanceReference, userName, userEmail, grantedScopes, consentStatus, consentGrantedAt, lastUsedAt }], total, page, limit }`. Display-safe — no CHD, no raw IBAN. |
| `GET` | `/merchants` | JWT | `merchant_officer`, `security_auditor` | List all merchant applications (officer review queue) |
| `PATCH` | `/merchants/:id/review` | JWT | `merchant_officer`, `security_auditor` | Approve or reject application (BIAN Action: Control). Transitions status to `agreed` or `rejected`. Writes `merchantAgreementKybCheck` BQ:Step. |
| `POST` | `/merchants/:id/keys` | JWT | `customer` | Generate new API key (plaintext returned once; `keyOrigin: 'generated'`) |
| `POST` | `/merchants/:id/keys/import` | JWT | `customer` | Register an EXISTING key from the merchant's own system. Hashed server-side (bcrypt), plaintext never stored/returned; only the prefix is shown. `keyOrigin: 'imported'`. 400 if too short, 409 if already registered |
| `PATCH` | `/merchants/:id/keys/:keyId` | JWT | `customer` | Rename (relabel) a key — `{ label }`; empty label clears it. Label is never a secret |
| `DELETE` | `/merchants/:id/keys/:keyId` | JWT | `customer` | Revoke API key |

`MerchantApiKeyRecord` adds `keyOrigin?: 'generated' | 'imported'` (display only; absent = generated). Both generate and import store only the bcrypt hash + display prefix (PCI DSS Req 3).

**v18 — OAuth client branding + consent grants payload (OIDC).**
- `PATCH /merchants/:id/oauth-client` accepts `logo_uri` and `client_uri` (OIDC client metadata, RFC 7591); both validated as **https** URLs (empty string clears). Persisted as `merchantOAuthClient.oauthLogoUri` / `oauthClientUri`.
- `GET /auth/grants` (self-scoped — the caller's own consent grants) payload now includes `merchantAgreementInstanceReference` and `oauthLogoUri` (nullable) alongside the existing `merchantName`, `grantedScopes`, `consentGrantedAt`, `lastUsedAt`. Used by the user's "Authorized Applications" listing.

**v18 — Authorized Applications: connected-app detail + per-app operations (D-01…D-02, self-scoped).**
These live under the OAuth consent-grant controller (`/api/v1/auth/grants/*`) and are **always scoped to the caller's own `sub`** (any PSP session token; no elevated role). A `consentId` that does not belong to the caller returns **404** (existence is never leaked). Display-safe — no CHD, no raw IBAN.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/grants/:consentId` | JWT (own session) | **D-01 — one authorized app (detail).** Returns `{ consentId, oauthClientId, merchantAgreementInstanceReference, merchantName, oauthLogoUri, oauthClientUri, grantedScopes[{ scope, description, required }], consentStatus, consentGrantedAt, lastUsedAt }`. `grantedScopes` expands each scope with its human-readable description from `SCOPE_CATALOG`. Branding (`oauthLogoUri`/`oauthClientUri`) from the merchant's `merchantOAuthClient` (OIDC client metadata). 404 if the grant is not the caller's. |
| `GET` | `/auth/grants/:consentId/operations` | JWT (own session) | **D-02 — operations the caller executed through this app.** Reads `businessProcessEvent` where `actingPartyReference == caller.sub` **AND** (`clientId == grant.oauthClientId` **OR** `merchantAgreementReference == grant.merchantAgreementInstanceReference`). Query filters: `q` (free text on `processAction`/`entityId`/`processType`), `dateFrom`/`dateTo` (ISO 8601), `page`/`limit`. Response `{ events[{ id, eventDateTime, processType, processAction, processOutcome, entityType, entityId, clientId, actingPartyReference, actingChannel, summary }], total, page, limit }`. Ownership of `:consentId` is verified first (404 otherwise). Display-safe (PCI DSS Req 3/7 · Req 10). |

**v18 — Granular consent (OAuth scope selection, E-01…E-13).**
- **Scope catalog** (`SCOPE_CATALOG`, single source of truth in `merchantOAuth.service.ts`): each scope maps to `{ description, required }`. `openid` is the only **required** scope; all others are optional/de-selectable (least-privilege, OAuth 2.0 Security BCP):

  Scopes follow the PSP `verb:resource` convention. As of **v23** they are enforced on the SHARED
  capability modules (no separate `/merchant/*` surface); the merchant is just another API client on
  the OAuth channel. Final Espresso Works client set:

  | Scope | Description | Required | Enforced by (shared module endpoint) |
  |---|---|---|---|
  | `openid` | Verify your identity | ✅ | OIDC baseline |
  | `profile` | Read your name and username | — | userinfo |
  | `read:beneficiaries` | View your saved beneficiaries | — | `GET /beneficiaries` |
  | `write:beneficiaries` | Add and manage your beneficiaries | — | `POST /beneficiaries`, `DELETE /beneficiaries/:beneficiaryRef` |
  | `write:transfers` | Send money and bank transfers | — | `POST /beneficiaries/:beneficiaryRef/transfer`, `POST /gateway/transfers/{preview,bank}` |
  | `read:transactions` | View your transaction and operation history | — | `GET /transactions` |
  | `read:accounts` | View your bank accounts (masked IBAN) | — | `GET /accounts` |
  | `read:merchant_profile` | View the merchant profile | — | `GET /auth/userinfo` |
  | `read:notifications` | View your notifications | — | `GET /notifications`, `POST /notifications/:id/read` |
  | `write:payments` | Create payments (server-to-server merchant charge) | machine only (`client_credentials`) | `POST /gateway/payments` |

- **v23 — Dual-auth capability surface (unify merchant onto the existing API).** The external merchant
  app consumes the SAME endpoints as first-party callers. Auth is a cross-cutting concern, resolved by
  `vendors/middleware/dualAuth.ts` (+ the `config: { dualAuth: true }` flag in the global `authMiddleware`):
  a route accepts EITHER a PSP session JWT (HS256 → RBAC) OR a merchant OAuth Bearer (RS256 → scope +
  subject binding). `dualPermission({ resource, action, scope })` authorizes; `resolveOwner()` derives the
  owner (OAuth: `resolveParty(token.sub)`; a path owner, if present, MUST equal `token.sub`). Owner-derived
  routes register both a paramless and a `:ownerRef`/`:partyRef` form sharing one handler (the path param
  is optional/derived). OAuth responses are display-safe: no CHD (PCI SAQ A), IBAN masked-only (GDPR/PSD2),
  never `counterpartyPartyReference`.

  | Capability | Endpoint(s) | Session RBAC | OAuth scope |
  |---|---|---|---|
  | List beneficiaries | `GET /beneficiaries` (+ `/:ownerRef`) | `beneficiaries:view` | `read:beneficiaries` |
  | Add beneficiary (phone/email lookup, anti-enumeration) | `POST /beneficiaries` (+ `/:ownerRef`) | `beneficiaries:manage` | `write:beneficiaries` |
  | Remove beneficiary | `DELETE /beneficiaries/:beneficiaryRef` (+ `/:ownerRef/:beneficiaryRef`) | `beneficiaries:manage` | `write:beneficiaries` |
  | Send to beneficiary (P2P, SD-65) | `POST /beneficiaries/:beneficiaryRef/transfer` (+ `/:ownerRef/:beneficiaryRef/transfer`) | `beneficiaries:manage` | `write:transfers` |
  | List payout accounts (masked IBAN) | `GET /accounts` (+ `/:partyRef`) | `accounts:view` | `read:accounts` |
  | Operation history (merchant-isolated, SD-89) | `GET /transactions` | `transactions:view` | `read:transactions` |
  | Preview bank transfer | `POST /gateway/transfers/preview` | `beneficiaries:view` | `write:transfers` |
  | Execute bank transfer (attributed `merchant.transfer.bank`) | `POST /gateway/transfers/bank` | `beneficiaries:manage` | `write:transfers` |
  | Notifications | `GET /notifications`, `POST /notifications/:id/read` | own session | `read:notifications` |

  > `:beneficiaryRef` is an opaque `counterpartyArrangementReference` (a resource id like `/orders/:orderId`),
  > NOT a credential; the owner is always derived from the Bearer token, never from the URL.
  > `POST /gateway/transfers/bank` body: `{ amount, currency, destination, rail?, reference?, fromAccountRef?, settlementSchedule? }`.
  > `fromAccountRef` is an opaque `payoutAccountInstanceReference`; `executeBankTransfer` verifies it belongs
  > to the initiator. `GET /transactions` under OAuth returns the party's merchant-isolated merged history
  > (SD-65 executions + own card transactions scoped by `merchantAgreementReference`); `/api/v1/transactions`
  > is a PUBLIC_EXACT path (simulator), so it detects the OAuth Bearer best-effort rather than via `dualAuth`.

- **v18 Item 2 — Server-to-server API payment (`POST /api/v1/gateway/payments`, `payment.controller.ts`).** Authenticated with the merchant's OWN OAuth **`client_credentials`** token (RS256, scope `write:payments`) — NOT a user session (HS256) and NOT the user `authorization_code` token. `config: { skipAuth: true }` + in-handler `validateMerchantToken(req, reply, 'write:payments')`; the acquiring merchant is bound to the token (a body `merchantAgreementInstanceReference` must match or is rejected 403). The PSP charges a **tokenised** card (test token vault, `PSP_API_PAYMENT_TEST_TOKEN`) so no PAN/CVV ever reaches the merchant (PCI SAQ A). Persists the SD-64 order + drives an SD-254 card transaction attributed to the merchant, so the commission fee (A-06) is applied and the merchant dashboard revenue reflects the API payment. Emits attributed `businessProcessEvent` (`merchant.payment.api`). Rejects 401 when no credential is presented, 403 without `write:payments`.

- `GET /auth/authorize` (consent render) now returns `scope_details` (array of `{ scope, description, required }`), `logo_uri`/`client_uri` (merchant branding), and — when called with `_psp_sub` — `previously_granted_scopes` (for re-consent highlighting).
- `GET /auth/authorize` (grant) accepts `_psp_scopes` (space/comma-separated user selection). The effective grant = `userSelected ⊆ allowedScopes` with all `required` scopes force-included. A requested scope **outside the client allowlist** returns `invalid_scope` (RFC 6749 §4.1.2.1) rather than being silently dropped.
- The authorization code and issued token scope derive from the user's selection (`grantedScopes`), not the raw request.
- **Incremental consent:** on token exchange, if a prior active consent grant exists, the added/removed scope delta is computed and audited on `businessProcessEvent` (`processType: consent_management`, actions `oauth.consent.granted|updated|reused`, SD-16) with merchant attribution. `grantedScopes` always reflects the freshly-consented set. Downstream (`GET /auth/grants`, "Authorized Applications") consumes the real `grantedScopes`.

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
| `officer@bank.demo` / *(password redacted)* | `merchant_officer` | `PTY-056` | Merchant Acquiring officer |
| `customer2@demo.com` / *(password redacted)* | `customer` | `PTY-057` | Simple customer, no merchant |
| `customer3@demo.com` / *(password redacted)* | `customer` | `PTY-058` | Customer with pending merchant app |
| `customer4@demo.com` / *(password redacted)* | `customer` | `PTY-059` | Dual-role customer + merchant |

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
| SAQ A scope | Card data entered only on `{PSP_URL_FRONTEND}/checkout/` and `{PSP_URL_FRONTEND}/pay/` — merchant domain never handles CHD |
| Card tokenization | Frontend generates `pm_<random>` surrogate; raw PAN never sent to backend API |
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

### 8.7 PSP_URL_FRONTEND Environment Variable

The `PSP_URL_FRONTEND` env var is used to construct hosted page URLs:
- `paymentPageUrl = ${PSP_URL_FRONTEND}/checkout/{sessionId}`
- `paymentUrl = ${PSP_URL_FRONTEND}/pay/{linkCode}`

Defaults to `http://localhost:8080` when not set.

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
  shows a shared-card indicator. **Investigation pivot** (L1/L2/auditor):
  `GET /api/v1/customer/card-by-token/:token` resolves a transaction's surrogate token
  (`paymentCardReference`) to the identifiers needed to continue an investigation:
  `paymentCardInstanceReference` (card detail), `customerAgreementInstanceReference` (owner/KYC) and
  `fundingPayoutAccountInstanceReference` (funding account), plus masked PAN / network / status. No
  CHD, no card expiry. Used by the transaction detail page to link the card token to the card page,
  resolve the customer when the account reference is not a canonical `ACC-xxx` (card-not-present
  merchant checkout), and link the funding bank account. Auditor Data Integrity
  (`/api/v1/fraud/integrity` → `cards`):
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
`backend/bin/seed-generate-cards.mjs`): valid future expiry (`MM/YY`), masked PAN, surrogate token,
unique alias per customer, one preferred card each, with a few non-active (expired/blocked) for
list-filter realism.

### 10.5 Frontend
- `/system/cards` — list with search (nickname / last-4), network + status filters, pagination
  (`Pagination`), rows link to detail. Customer-only (own section, not part of the profile).
- `/system/cards/[cardId]` — owner self-service detail: token, expiry, dates, status; inline edit
  of alias/note; remove (soft-delete with confirm). Technical labels (QE/token) only in debug mode.

*Added 2026-06-13; detail/edit/seed/payment-integration extension same day (doc + code together per repo rules).*

---

## 10.6 OIDC/OAuth flow audit trail (v26)

Every step of the OIDC/OAuth flow (PSP authorization server + merchant client + CIBA) is auditable
end-to-end so an integration failure can be pinpointed to the exact step and cause. Reuses the v7/v8
compliance ledger (`emitComplianceEvent` + `LedgerProjection`); no new store. Visible in the unified
audit (`/system/audit-events`), which is gated to **`security_auditor` or `manager`**
(`processEvent.controller.ts`).

**Helper.** `modules/identity/services/oauthAudit.service.ts` — `auditOAuth(db, action, opts)` emits a
`complianceProcessEvent` with `processType: 'authentication'`, `bianServiceDomain: 'SD-16 Party
Authentication'`, `bianControlRecordType: 'AuthenticationSession'`. `classifyOAuthFailure(err, msg)`
maps a raw OAuth error to a human cause (`bad_client_secret`, `missing_client_secret`,
`unknown_client`, `client_inactive`, `merchant_inactive`, `pkce_mismatch`, `pkce_missing`,
`redirect_uri_mismatch`, `code_expired`, `code_replayed`, `code_not_found`, `invalid_scope`,
`unsupported_grant_type`, `invalid_token`). `auditOAuthWithMerchantLookup` resolves the merchant name
from the `clientId` for failure events (so an auditor sees WHO attempted).

**Correlation.** Anchored on `hash(state)` (a SHA-256 prefix, `flow:…`): `state` is persisted on
`partyAuthorizationCode` and present on both the authorize and token halves, so events of one flow
share it as the ledger `correlationId` **without any schema change**. The merchant logs the same
`state` hash as `flowId`, joining merchant logs to the PSP ledger. Refresh/userinfo/revoke (no state)
correlate on `sub`/`clientId`.

**Events emitted.**

| Action | When | Key `eventSummary` fields |
|---|---|---|
| `oauth.authorize.initiated` | `/authorize` validated | clientId, merchantName, flowId, scopes |
| `oauth.authorize.denied` | user denies consent | clientId, flowId, reason=access_denied |
| `oauth.code.issued` | grant → code minted | clientId, sub, flowId, scopes |
| `oauth.token.issued` | authz_code / client_credentials | clientId, merchantName, sub?, grantType |
| `oauth.token.refreshed` | refresh_token grant | clientId, merchantName, sub |
| `oauth.token.failed` | any `/token` error | clientId, merchantName, grantType, **failureCause** |
| `oauth.userinfo.accessed` | userinfo (ok/failed) | clientId, sub, scopes / reason |
| `oauth.token.revoked` | RFC 7009 revoke | clientId, sub |
| `auth.login` / `auth.login.failed` / `auth.login.blocked` | PSP portal login | sub, role, domain, failureCause (invalid_password / account_pending / account_suspended) |
| `oauth.callback.delivered` / `oauth.callback.failed` | OAuth webhook delivery to the merchant | eventType, targetHost, responseStatus, attempts, failureCause |

The webhook (callback) delivery also keeps its detailed `merchantWebhookLog` row (`delivered`,
`responseStatus`, `attempts`, `error`, `requestUrl`) shown in the merchant Events view.

**Secret redaction (PCI DSS Req 10 / GDPR).** `vendors/eventbus/sanitize.ts` adds `SECRET_BLOCKLIST`
(access/refresh/id token, code, code_verifier, client_secret, Authorization, cookie, email, phone) and
`redactSecrets(value)` used by the audit helper and the merchant logger. `state`/`nonce` are logged
only as a hash, never raw. CHD stays under the separate `CHD_BLOCKLIST` (Req 3.2).

**Merchant logging.** `merchant/src/lib/logger.ts` — server-only structured JSON logger with the same
redaction and a `flowId` field. Instruments `login.initiated`, `callback.received`,
`callback.token_exchanged`, `callback.login_success`, `callback.invalid_state`, `callback.no_subject`,
`callback.psp_error`, `callback.failed`, `discover.unreachable/failed`, `token.exchange.failed`,
`userinfo.failed/error`, and CIBA (`ciba.bc_authorize.*`, `ciba.poll.*`). All emission is
fire-and-forget and never blocks the auth response (Req 10.2.1).

*Added 2026-07-14 (v26; doc + code together per repo rules).*

---

## 11. Event-Driven Architecture (dev.v8)

**EventBus vendor** (`backend/src/vendors/eventbus`). One bus for all events behind the `EventBus` port (`publish`/`subscribe`); default adapter `EventBusInProcess` (Node `EventEmitter`). Swap to Kafka/RabbitMQ = change the adapter in `initEventBus` only. `DomainEvent` envelope: `eventId` (idempotency), `eventType` (dotted, module-prefixed), `occurredAt`, `correlationId` (the journey; = `cardTransactionInstanceReference` for a payment), `causationId`, `businessProcess`, `partitionKey`, `source`, `actor?`, `bian?`, `payload` (CHD stripped on publish), `schemaVersion`, `transient?` (delivered, not persisted).

**Collection `domainEvent`** (regular, not time-series — carries a unique `eventId` index). Indexes: `{eventId} unique`, `{correlationId, occurredAt}`, `{businessProcess, occurredAt}`, `{eventType, occurredAt}`, `{partitionKey, occurredAt}`. Created in `createCollections`/`createIndexes`; validated in `validateSetup`. Every business/compliance/integration emit also mirrors here (correlated). Read the journey with `GET /api/v1/events/trail/:correlationId` (auditor/manager).

**Async payment authorization.** `POST /api/v1/transactions` returns `202 { cardTransactionInstanceReference, cardTransactionStatus: 'pending' }`. The client subscribes to `GET /api/v1/transactions/:id/stream` (SSE, public by txn UUID, `skipAuth`, no PII/CHD, race-safe) for the terminal `authorized`/`declined`. Transient `cardVerification { cardNumber, cvv, expiry }` on create is forwarded to the issuer only and never stored or logged.
- **Phase 1 gate** (parallel, out-of-band): `card-issuer` + `fds` + `hrp` (sanctions). Each publishes its `*.completed` verdict; `PaymentAuthorizationSaga` aggregates, any hard decline gives `payment.declined`, all approve gives `payment.authorized`.
- **Phase 2** (post-auth, async): `PostAuthorizationProcess` runs AML monitoring and enriches the case from the correlated trail into a new schemaless field `fraudDiagnosisCase.subsystemSignals { issuer, fds, sanctions, aml }`.
- `createTransaction` remains a synchronous wrapper (initiate + await terminal) so the gateway (checkout / payment-link) is unchanged. See ADR-032.

*Added 2026-06-16 (dev.v8; doc + code together per repo rules).*

---

## v17 — Funds-Availability Gate, Currency Exchange & Balance Reconciliation

Implements [engineering-proposal.md ADR-038](engineering-proposal.md). Money-movement cycle precision.

**New bus events** (`shared/models/events/fundsCheck.events.ts`): `funds.check.requested` / `funds.check.completed` (BIAN SD-36). Payload of completed: `{ transactionId, outcome, responseCode?, decisionReason?, available?, held?, currency?, fundingPayoutAccountReference?, converted?, fxRate? }`.

**Saga** (`paymentAuthorization.saga.ts`): `funds` added to `GATE_EVENT` + `DEFAULT_GATES` (now 4 parallel gates). `gatesExpected` type extended to include `'funds'`; `card.payment.authorization.requested` emits it. On decline, `releaseCardHold` compensates (idempotent, race-safe). `funds.check.requested` emitted from `emitGateRequests`.

**Funds gate reactor** (`providers/groups/providerGroups.ts` → `onFunds`): resolves `cardToken → fundingPayoutAccount`; reads balance via `dispatchProvider('account_information', …)` (provider-indifferent); FX-converts via `resolveAndConvert`; atomic `holdCardFunds` ($gte-conditional). Only debit types (`purchase`/`cash_advance`/`fee`) with an internal funding account are gated; others pass through.

**Balance ops** (`payoutAccountBalance.service.ts`): added `releaseCardHold` (pending → available). Existing `holdCardFunds`/`settleCardDebit` unchanged.

**Response codes** (`shared/models/responseCodes.ts`): `RESPONSE_CODE_APPROVED='00'`, `RESPONSE_CODE_DECLINED='05'`, `RESPONSE_CODE_INSUFFICIENT_FUNDS='51'`, `DECISION_REASON_INSUFFICIENT_FUNDS`, `DECISION_REASON_ACCOUNT_NOT_FOUND`. Insufficient funds → `cardTransactionStatus='declined'` + `'51'` (no new status; BIAN uses the reason code).

**Currency Exchange** (`providers/currency-exchange/services/currencyExchange.service.ts`, capability `currency_exchange` added to `IntegrationProviderType` + `bianMetaFor`): `convert(amount, from, to, config)` mid cross-rate + spread; `resolveAndConvert(db, …)` reads `capabilityModuleConfiguration('currency-exchange')`. Used at card hold/settle, merchant debit/credit, P2P credit, refund.

**Post-auth** (`postAuthorization.process.ts`): debit hold removed (now in the gate — no double-hold); only refund `creditDirect` remains (FX-aware).

**Seeders**: all currencies normalized to EUR (`payoutAccounts.json`, `cardTransactions.json`, `merchants.json`, `fraudCases.json`, `seed-generate.ts`); `pending/reserved` zeroed; `seedBalanceCredits` opening deposit == total balance (reconciled start).

*Added 2026-07-03 (v17; doc + code together per repo rules).*

## v17.1 — Bank Transfers (ACH / SEPA / SWIFT)

**Rail engine** (`backend/src/shared/services/bankTransfer/`): `RailResolver.resolve(destination, override?)`
+ `.validate(rail, destination)`, `FeeCalculator`, pure validators `isValidIban` (ISO 13616 mod-97),
`isValidBic` (ISO 9362), `isValidRoutingNumber` (NACHA ABA checksum). Standard return-code maps:
`ACH_RETURN_CODES`, `SEPA_REJECT_CODES`, `SWIFT_ERROR_CODES`.

**Types:** `PayoutRail` and `PaymentInitiationOutbound.railType` extended with `'swift'` (unions kept in
sync). `InitiateTransferInput` accepts optional `rail`, `destination`, `recurring`.

**API:**
- `POST /api/v1/gateway/transfers/preview` — derive rail, validate coordinates, quote fee (stateless).
- `POST /api/v1/gateway/transfers/bank` — execute a transfer to an external account; validates via the
  rail engine, persists an SD-65 `PaymentExecutionProcedure` (routing -> in_flight), and dispatches to
  the `payment_initiation` provider. Returns `202` (submitted) or `422` (exception/failed).

**Compliance:** bank coordinates never travel on the bus (wire adapter resolves them); every transfer
emits business + compliance events correlated by the execution reference (PCI DSS Req 10).

*Added 2026-07-04 (v17.1; doc + code together per repo rules).*

### v17.1 — Bank transfer config (G7)

Env vars (config.payout): `PAYOUT_SANDBOX` (default true; transfers simulated end to end),
`PAYOUT_FEE_SEPA` (0), `PAYOUT_FEE_ACH` (0.25), `PAYOUT_FEE_SWIFT` (15), `PAYOUT_FEE_LOCAL_BANK` (0),
`PAYOUT_FEE_SWIFT_CORRESPONDENT` (10). The fee schedule is the single source consumed by
`FeeCalculator` (preview and execution quote the same fee). Rail failure simulation reuses
`PAYMENT_INITIATION_ALWAYS_SUCCEED`.

*Added 2026-07-04 (v17.1/G7).*

### v17.1 — Recurring mandates (ACH SDD / SEPA SDD)

Collection `recurringMandateProcedure` (SD-66). Endpoints:
- `POST /api/v1/gateway/transfers/mandates` — create a mandate (scheme, amount, currency, destination, frequency, optional maxRuns). Destination validated by the rail engine.
- `GET /api/v1/gateway/transfers/mandates` — list the caller's mandates.
- `DELETE /api/v1/gateway/transfers/mandates/:ref` — cancel a mandate.
- `POST /api/v1/gateway/transfers/mandates/run-due` — scheduler hook: runs all mandates with nextRunAt <= now, each via executeBankTransfer (rail engine + provider dispatch + risk gate), advancing nextRunAt (UTC) and completing at maxRuns.

*Added 2026-07-04 (v17.1).*

## 12. v24 — CIBA + Passwordless Enrollment (SD-91/SD-16)

CIBA (OIDC Client-Initiated Backchannel Authentication, Core 1.0) + WebAuthn-style passwordless
credential enrollment. Extends the existing OAuth 2.0 / OIDC server in `module: identity`. No browser
redirect, no password. The user approves out-of-band on an Authentication Device by signing a server
challenge with an enrolled private key; the server verifies against the stored public key.

### 12.1 Data models (§1 addendum)

`partyEnrolledCredential.model.ts` (SD-91/SD-16 — new, PLAINTEXT: public keys only, no CHD/PII):
- `partyEnrolledCredentialInstanceReference` (PK), `customerAuthenticationInstanceReference` (owner sub),
  `credentialId` (unique), `publicKeyPem` (SPKI, public only), `alg` (`RS256`|`ES256`), `signCount`
  (monotonic anti-replay), `authenticatorMetadata` { deviceName?, aaguid?, transports?, createdVia? },
  `status` (`active`|`revoked`), `createdAt`, `lastUsedAt?`, `revokedAt?`, BIAN meta + `schemaVersion`.

`partyBackchannelAuthentication.model.ts` (SD-91 — new, TTL-expiring, patterned on partyAuthorizationCode):
- `authReqId` (PK, unique), `clientId` (BOUND: only this client redeems), `customerAuthenticationInstanceReference`
  (sub from hint), `scopes`, `challenge` (server nonce), `bindingMessage?`, `deliveryMode`
  (`poll`|`ping`|`push`), `clientNotificationToken?`, `status`
  (`pending`|`approved`|`denied`|`expired`|`consumed`), `interval`, `expiresAt` (TTL), `lastPolledAt?`,
  `credentialIdUsed?`, `signatureVerifiedAt?`, BIAN meta.

`merchantAgreement.model.ts` extend: `OAuthGrantType` += `urn:openid:params:grant-type:ciba`; new type
`OAuthBackchannelDeliveryMode`; `MerchantOAuthClientConfig` += `oauthBackchannelTokenDeliveryMode?`,
`oauthBackchannelClientNotificationEndpoint?` (HTTPS-only, required for ping/push).

`externalProviderArrangement.model.ts` extend: `ComplianceProcessType` += `authentication` (CIBA +
enrollment audit, PCI Req.8/10, timeseries 365d via `emitComplianceEvent`).

### 12.2 Indexes (§5 addendum)
- `partyEnrolledCredential`: unique `partyEnrolledCredentialInstanceReference`; unique `credentialId`;
  `{ customerAuthenticationInstanceReference: 1, status: 1 }`.
- `partyBackchannelAuthentication`: unique `authReqId`; TTL `{ expiresAt: 1 }, expireAfterSeconds: 0`;
  `{ clientId: 1, status: 1 }`; `{ customerAuthenticationInstanceReference: 1, status: 1 }`.

### 12.3 API contracts (§6 addendum)

Enrollment (tag `auth:enrollment`, SESSION-gated, owner-scoped):
- `POST /api/v1/auth/enroll/challenge` — issue a stateless HMAC-bound registration challenge.
- `POST /api/v1/auth/enroll` — register a public key + signed challenge (proof of possession). Returns credential.
- `GET  /api/v1/auth/enroll` — list the caller's credentials (owner-scoped; never another user's).
- `POST /api/v1/auth/enroll/:credentialId/rotate` — register replacement, revoke old.
- `DELETE /api/v1/auth/enroll/:credentialId` — revoke (foreign id 404s).

CIBA (tag `auth:ciba`):
- `POST /api/v1/auth/bc-authorize` — client-authenticated (client_secret_basic). Body: exactly one of
  `login_hint`/`login_hint_token`/`id_token_hint`, `scope`, optional `binding_message`/`requested_expiry`;
  `client_notification_token` required for ping/push. Returns `{ auth_req_id, expires_in, interval }`.
- `GET  /api/v1/auth/bc-authorize/pending` — SESSION-gated decoupled in-app AD list (owner-scoped).
- `GET  /api/v1/auth/bc-authorize/:authReqId` — fetch challenge + binding_message + client name (public by
  reference; approval still needs the signature).
- `POST /api/v1/auth/bc-authorize/:authReqId/approve` — assertion-authenticated (signature over challenge IS
  the auth). Verifies signature vs stored public key, owner==hint sub, bumps signCount.
- `POST /api/v1/auth/bc-authorize/:authReqId/deny` — assertion or owner session (anti-DoS).
- `POST /api/v1/auth/token` (existing route, new grant branch) — `grant_type=urn:openid:params:grant-type:ciba`,
  `auth_req_id`. Verifies the client owns the auth_req_id (else `invalid_grant`). Errors:
  `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `invalid_grant`. Mints tokens via
  `issueTokens()`, marks `consumed`.
- `GET/POST /api/v1/auth/ciba/notify` — DEMO-ONLY ping/push stub receiver (Bearer = client_notification_token),
  in-memory ring buffer for demo visualisation. Not part of the CIBA protocol; not for production.

Discovery (`/.well-known/openid-configuration`) adds: `backchannel_authentication_endpoint`,
`backchannel_token_delivery_modes_supported: [poll,ping,push]`, `backchannel_user_code_parameter_supported: false`,
`backchannel_authentication_request_signing_alg_values_supported: [RS256,ES256]`, and the ciba grant in
`grant_types_supported`.

Consent detail (`GET /api/v1/auth/grants/:consentId`) adds `cibaEnabled` (client may initiate CIBA).

### 12.4 Seed / setup (source of truth)
- `createCollections.ts` + `createIndexes.ts`: the two new collections + indexes (plaintext; no new DEK/QE).
- `data/enrolledCredentials.json` + `seedEnrolledCredentials.ts` (registered in seed `index.ts`): the demo
  user (Luis) gets one active ES256 credential (public key). The matching private key is a test/demo fixture
  (`backend/test/fixtures/demoAuthenticatorKey.ts`), never stored server-side.
- `data/merchants.json`: the Espresso client gains the ciba grant + `oauthBackchannelTokenDeliveryMode: poll`.

### 12.5 Compliance posture
- PCI DSS v4.0: auth server is in-scope by connectivity. Stores public keys only (Req.3); TLS 1.2+ + HTTPS
  notification endpoint for ping/push (Req.4); audit via `emitComplianceEvent` -> `complianceProcessEvent`
  (365d, Req.10); anti-replay via one-time auth_req_id + monotonic signCount (Req.8).
- NIST SP 800-63B: software authenticator + user-presence = AAL1. AAL2 (platform biometric/PIN UV) is a later
  upgrade with NO contract change. Do NOT claim AAL2 until UV is enforced.
- PSD2: authentication-only in v24; payment authorization deferred pending RTS Art.5 dynamic linking.
- Browser key storage: WebCrypto `extractable:false` + IndexedDB (never localStorage).

*Added 2026-07-09 (v24; doc + code together per repo rules).*

## 13. v25 — Merchant app passwordless login (CIBA client, browser authenticator)

The external merchant app (`merchant/`, DB-less) consumes the v24 PSP CIBA capability to offer redirect-free
passwordless login, alongside the existing Authorization Code + PKCE SSO (SSO stays the default/fallback).
Almost entirely client-side: no new PSP endpoint or data model, and the only PSP-side change is making the
v24 enrollment routes `dualAuth` so a user-delegated merchant OAuth Bearer can enroll (see §13.1.1).
Decisions: AD calls proxied server-side (no CORS), ES256 browser default, `login_hint_token` (opaque sub,
no raw PII), profile hosts enroll + generator.

### 13.1 Client libraries (`merchant/src/lib`)
- `authenticator.ts` (`use client`) — the LOGIN credential: ES256 (`ECDSA`/`P-256`), private key
  `extractable:false` in IndexedDB (`ew-merchant-passwordless`), plus a metadata record (`credentialId`,
  `alg`, `sub`, `email`, `createdAt`). Exposes `hasCredential`/`createCredential`/`saveMeta`/`sign`/
  `signWithCredential`/`getMeta`/`loginHintToken`/`deleteCredential`. Raw r||s signatures (PSP verifier
  normalizes raw→DER). Never exported, never in localStorage.
- `keygen.ts` (`use client`) — standalone THROWAWAY ES256 generator (extractable, downloadable JWK/PEM),
  NOT stored in the login store, NOT enrolled, NOT used for auth. Distinct from the login credential.
- `oauth.ts` (server) — adds `backchannelAuthorize()` (confidential client → PSP `bc-authorize`, discovers
  `backchannel_authentication_endpoint`) and `cibaTokenPoll()` (maps `authorization_pending`/`slow_down`/
  `access_denied`/`expired_token`). `env.ts` adds `pspCredentialsUrl` (link to the PSP keys page).

### 13.1.1 PSP adjustment required by v25 (enrollment via OAuth)
The v24 `/api/v1/auth/enroll*` routes were session-gated by the global HS256 `authMiddleware`, which rejects
the merchant's RS256 OAuth Bearer (401). v25 makes all five enrollment routes `config: { dualAuth: true }`
(the v23 pattern): they now accept EITHER a first-party portal session (HS256) OR a user-delegated merchant
OAuth Bearer (RS256, via `tryMerchantContext`). `enrollment.controller.getSubFromRequest` also reads
`request.merchantContext.sub`. Enrollment stays owner-scoped (bound to the resolved user sub); the PSP still
stores public key material only. This is the single PSP-side change in v25.

### 13.2 Merchant route handlers (`merchant/src/app/api/auth/ciba/`, `server-only`)
- `POST /api/auth/ciba/enroll/challenge` — session-gated relay to PSP `POST /enroll/challenge` (Bearer attached;
  sends `{}` body since the PSP derives the owner from the token, and Fastify rejects an empty JSON body).
- `POST /api/auth/ciba/enroll` — session-gated relay to PSP `POST /enroll` (public key only).
- `POST /api/auth/ciba/start` — session-LESS; confidential client → PSP `bc-authorize` with `login_hint_token`
  + REQUESTED_SCOPES; returns `{ auth_req_id, interval, expires_in, binding_message }`.
- `POST /api/auth/ciba/poll` — session-LESS; polls PSP `/token` (ciba grant); on approval verifies id_token,
  builds the same `ew_session` cookie as SSO callback, returns `{ status }`.
- `GET  /api/auth/ciba/challenge?auth_req_id=` — session-LESS relay to PSP `GET /bc-authorize/:id` (AD step).
- `POST /api/auth/ciba/approve` — session-LESS relay to PSP `POST /bc-authorize/:id/approve` (assertion auth).

NOTE: the AD relays are session-less because passwordless login happens when logged out; the shared
allowlist proxy `api/psp/[...path]` requires a session and is unsuitable for the login path. Approval is
gated by the signature at the PSP, so serving the challenge to the `auth_req_id` holder is safe.

### 13.3 UI (`merchant/src/components`, `merchant/src/app`)
- `PasswordlessLoginButton.tsx` — on landing, renders ONLY when a credential exists (else SSO only); runs
  start → challenge → sign → approve → poll → redirect; on revoked credential clears IndexedDB + falls back.
- `EnrollPasswordless.tsx` + `Es256KeyTool.tsx` — hosted on `app/profile/page.tsx` (enroll/status + Sec4
  Pay keys link + throwaway generator). `app/page.tsx` renders the login button in the logged-out branch.

### 13.4 Seed / compliance
- No seed change: the Espresso client (`oauth001-...`) already carries the ciba grant + `poll` delivery (v24).
- PCI DSS v4.0: merchant is NOT in the CDE (no CHD). Req.4 (TLS merchant↔PSP), Req.6 (secure SDLC), Req.8
  (no shared secrets in the browser; only a non-extractable private key). Tokens stay in the encrypted
  server-side `ew_session` cookie, never in the browser. NIST AAL1 (AAL2 later via platform UV, no contract
  change). GDPR: `login_hint_token` avoids raw email in the hint.

*Added 2026-07-10 (v25; doc + code together per repo rules).*

## 14. v28 — Request to Pay (RTP) + shared QR + Verification of Payee (VoP)

> Delivered under development plan `tmp/dev.v28.plan.md`. RTP is a BIAN-aligned **intent domain**
> (SD-65) kept strictly separate from payment execution. Model: a transfer that requires the payer's
> **in-app approval** (no CIBA). On approval a distinct `paymentExecutionProcedure` is created and
> linked by immutable reference, then routed via the `payment_initiation` provider using the same
> balance-aware hold→settle→credit sequence as P2P. RTP is account/alias-based → **outside PCI scope**.

### 14.0 Card acceptance method (payment-history classification)
`cardTransactionLog.cardTransactionAcceptanceMethod?` (plaintext, optional): `'api' | 'payment_link' |
'redirect_checkout' | 'pos' | 'ecommerce'`. Set by the accepting flow (paymentLink.service →
`payment_link`, checkout.service → `redirect_checkout`, direct API card → `api`) so `/system/payment/history`
can classify card payments by method (Payment Link / Redirect vs plain Card). Seeded rows may omit it
(shown as "Card"). No collection/QE/index change; consumed by the history list filters.

### 14.1 Data model (setup + seed are the single source of truth)
- **`paymentRequestProcedure`** (QE-encrypted): canonical rail-agnostic request. QE:none (L2 only)
  fields: `payeeName`, `payeeAlias`, `payerAlias`, `unstructuredRemittance`, `structuredAddress`
  (5 DEKs: `DEK-rtp-payee-name/-payee-alias/-payer-alias/-rtp-remittance/-rtp-address`). Aliases also
  stored as a non-reversible SHA-256 `*AliasHash` (plaintext, indexed) for directory lookups (GDPR
  minimization). QE cannot encrypt `null` (err 31041): omitted encrypted fields are stripped before insert.
- **`paymentRequestEvent`** (timeseries, TTL 365d, meta=`paymentRequestInstanceReference`): per-request trail.
- **`qrPaymentRepresentation`** (plaintext): shared QR capability (RTP / payment_link / checkout). Stores
  only the encoded payload (signed deep link / EPC / EMVCo), never the image. Single-use + TTL.
- **`rtpAliasDirectoryCache`** (plaintext): `aliasHash` (unique) → party/counterparty, TTL.
- Indexes: see `createIndexes.ts` (inbox/outbox, expiry sweeper `{status,expiresAt}`, linkage, idempotency).
- `BusinessEntityType` gains `'payment_request'`; `NotificationType` gains `'payment_request'`.
- v32: `BusinessEntityType` gains `'beneficiary'` (SD-54 CounterpartyArrangement), so the per-record beneficiary disclosure event emitted by the beneficiary search is attributed to its own control record (PCI DSS Req 10.2.2).

### 14.2 Lifecycle (monotonic, validated by `rtpStateMachine.ts`)
`draft→created→validated→presented→delivered→viewed→accepted|rejected|cancelled|expired`,
`accepted→payment_initiated→payment_processing|payment_settled|payment_failed`, `payment_settled→reversed|disputed`.
Expiry sweeper (`RtpLifecycleProcess`, 60s interval) transitions lapsed pre-acceptance requests to
`expired` with an auditable event (not TTL-only). Settlement (`bank.transfer.settled/failed`) is projected
back onto the linked request by `RtpLifecycleProcess`.

### 14.3 Approval (balance-aware, `rtpApproval.service.ts`)
Funds check (AIS) → screening (`screenRtpRequest`: FDS+HRP+AML via `transferRiskGate` **plus VoP**, additive)
→ `holdCardFunds` on the payer funding account → create SD-65 execution (`sourcePayoutAccountReference`=payer,
`resolvedPayoutAccountReference`=payee) → dispatch `payment_initiation`. `PayoutOrchestrationProcess`
settles (`settleCardDebit` + `creditDirect`). Preconditions: payee needs an active receiving account to
request (`422 no_payout_account`); payer needs an active funding account to approve (`422 no_funding_account`).
Durable `authorizationContext` (session/subject/device/timestamp/result) persisted immutably.

### 14.4 VoP capability (`vop` / `vop_verification`) — additional, independent (ADR-v28-01)
First-class provider capability mirroring FDS/AML/HRP: registry (`capabilities.ts`), built-in module
(`providers/vop/*`, engine `verifyPayee`: exact / normalized / token-order / Levenshtein + thresholds +
decision policy + market gate → `match|close_match|no_match|not_supported`), provider-group reactor
(`vop.verification.requested`→`.completed`), canonical ledger event, seed (provider `int-internal-vop-001`,
capability config, routing group). NOT a replacement for FDS/AML/HRP; blocks only when policy makes it
mandatory. Stub swappable for the real EPC VoP inter-PSP API / UK CoP / AI-agent matcher without changing
the wire contract. Admin dashboard `/system/admin/modules/vop`. Config: `PSP_RTP_VOP` + `PSP_RTP_VOP_MARKETS`.

### 14.5 API (`/api/v1/gateway/rtp/*`, `/api/v1/gateway/qr/*`)
`POST/GET /requests`, `GET /requests/:ref`, `/present`, `/view`, `/verify-payee`, `/accept`, `/reject`,
`/cancel`, `/events`, `/qr`; shared `POST /gateway/qr/represent`, `GET /gateway/qr/:ref`. All mutating routes
use `dualPermission` (session RBAC `paymentRequests:view/manage` OR merchant OAuth `read:rtp`/`write:rtp`)
+ idempotency keys. ACL resource `paymentRequests` (SD-65); OAuth scopes `read:rtp`/`write:rtp` (SCOPE_CATALOG
+ merchant client seed + REQUESTED_SCOPES). Config gate `PSP_RTP_ENABLED`. ISO 20022 mapper: `rtpIso20022.mapper.ts`.

*Added 2026-07-17 (v28).*

## 15. v30 — Realistic per-card CVV, issuer CVK, and the card-issuer PAN vault (SD-88)

v30 raises the fidelity of the built-in `card-issuer` module so the CVV behaves as it does in a real
issuer (derived per card from an issuer key, never stored), while keeping a global escape-hatch CVV for
fast demos. It also introduces the first **module-owned data**: the issuer key (CVK) in the key vault and
a dedicated PAN vault collection (`cardIssuerVault`). The PSP core stays descoped for the PAN: it keeps
only the token plus BIN and last 4. See ADR-043 and ADR-044 in `engineering-proposal.md`.

### 15.1 CVV derivation + `cvvMode`

Source: `backend/src/providers/card-issuer/services/cardVerificationKey.service.ts`.

The per-card CVV is derived, never persisted (PCI DSS Req 3.2, SAD):

```
perCardCvv(card) = digits( HMAC-SHA256( CVK, cardToken + '|' + expiryMMYY + '|' + serviceCode ) )[0 : cvvLength]
```

- `cvvLength` per network: Visa / Mastercard = 3, Amex = 4.
- `cardToken` = `paymentCardReference` (surrogate, not CHD); `expiryMMYY` from `paymentCardExpirationDate`;
  `serviceCode` from the vault (`cardServiceCode`) or the constant `'201'` when the vault is inactive.
- Derived on demand in validation and reveal; the value never enters any collection, log, listing, or
  validation response.

Config key `cvvMode` in `capabilityModuleConfiguration` for capability `card-issuer` (via `GET|PUT /config`):

| `cvvMode` | Accepted CVV |
|---|---|
| `both` (default) | global escape-hatch (`validCvv`, default `'123'`) OR the derived per-card CVV |
| `global` | only the global `validCvv` (simple demo) |
| `per_card` | only the derived per-card CVV (strict / realistic demo) |

### 15.2 CVK in the key vault (envelope encryption)

The Card Verification Key (CVK) is issuer key material owned by the `card-issuer` module, one per module
instance in v30. It is provisioned once and never stored in cleartext:

```
KMS / master key  →  DEK (wrapped in encryption.__keyVault)  →  CVK (HKDF from the unwrapped DEK)
```

- `provisionCardIssuerCvk()` provisions the DEK (idempotent, by `keyAltNames` alias) and wires from
  `vendors/setup/provisionDEKs.ts`; `getCardIssuerCvk()` unwraps via the raw (non-QE) client and derives
  the CVK in memory only via HKDF; `derivePerCardCvv()` computes the HMAC.
- Rotation: rotate the DEK / re-key the vault; the CVV contract is unchanged. Per-card CVK is out of scope
  for v30.
- No new business collection and no new CHD are introduced by the CVV feature itself.

### 15.3 `cardIssuerVault` — module-owned PAN vault (BIAN Card Administration)

Module-owned CDE collection, only present / used while the built-in `card-issuer` is the active provider.
BIAN control record: **Card Administration** (the issued device of the issuer), confirmed in F0, not
invented. The PSP core never reads this collection; the cross-frontier read is only via a port.

```typescript
export const CARD_ISSUER_VAULT_COLLECTION = 'cardIssuerVault';

export interface CardIssuerVaultControlRecord {
  issuedCardInstanceReference: string;        // PK, UUID (module key)
  paymentCardReference: string;               // FK token; join to the core via the Card Reference port
  paymentCardInstanceReference: string;       // FK to the core arrangement
  paymentCardNumber: string;                  // full PAN (CHD) — QE:equality
  cardServiceCode: string;                    // issuer data, CVV derivation input — QE:equality
  cardIssuerCvkKeyId: string;                 // reference to the DEK/CVK (not the key itself)
  issuedCardStatus: string;
  bianServiceDomain: 'Card Administration';
  bianControlRecordType: 'CardAdministration';
  recordCreatedDateTime: Date;
  schemaVersion: number;
  // CVV: SAD — never stored (derived)
}
```

QE fields (`vendors/encryption/encryptedFieldsMaps.ts`), equality only (compatible with server 8.0;
substring/suffix intentionally OFF, R13):

| Field | Classification | QE | DEK |
|---|---|---|---|
| `paymentCardNumber` (full PAN) | CHD | QE:equality | `DEK-vault-pan` (`deks.vaultPan`) |
| `cardServiceCode` | issuer data | QE:equality | `DEK-vault-service-code` (`deks.vaultServiceCode`) |

### 15.4 Core `paymentCardManagement` changes (descoped for PAN)

| Field | Change | Classification | Storage |
|---|---|---|---|
| `paymentCardBin` (first 6) | NEW | non-CHD (BIN, PCI permits ≤ 8) | plaintext, indexed (BIN prefix + network) |
| `paymentCardLast4` (last 4) | NEW | non-CHD | plaintext, indexed (display + equality / suffix search) |
| `paymentCardMaskedPanDisplay` | no longer persisted | display only | derived on the fly from `bin` + `last4` + `network` via `deriveMaskedPan()` |

The masked PAN string is still returned by the API (computed in the DTO), so there is no v29 breaking
change. The interface keeps the field optional for compile safety; the seed `$unset`s it. The
`cardTransactionLog.cardTransactionMaskedPanDisplay` ledger snapshot is untouched (append-only, immutable).
The core never stores the full PAN; removing the module (or using an external provider) leaves the core
without PAN CHD.

### 15.5 Ports (Hexagonal, cross-frontier reads)

| Port | Purpose |
|---|---|
| Card Reference port | module reads `paymentCardManagement` (token, expiry, status, funding account) |
| Funding Account port | resolve `payoutAccountArrangement` from a card (validation + cross-linking) |
| Card-by-account port | `account-information` lists cards by funding account (reuses `getCardsByFundingAccount`) |

### 15.6 API surface (additive)

Built-in `card-issuer` (`/api/v1/modules/card-issuer`):
- `POST /score` — extended: validates network + format (Luhn + length) + registered (card-on-file via
  Card Reference port) + funding account known (Funding Account port) + CVV (global | per-card per
  `cvvMode`). Loopback (`skipAuth` + `X-Integration-Source`). No CVV in the response.
- `POST /reveal` — new loopback: derives and returns the ephemeral CVV (owner provider flow only).
- `POST /reveal-pan` — new loopback: returns the ephemeral PAN (owner provider flow only).
- `GET /cards/:cardId/cvv` — new (JWT): direct reveal for `operations_officer`.
  `requirePermission('cards','manage')` + `requireInternalProvider('card_issuer')` + audit
  `card.cvv.revealed`. 409 `managed_externally` when external; 403 for other roles.
- `GET /cards/:cardId/pan` — new (JWT): direct PAN reveal for `operations_officer`, same gate, audit
  `card.pan.revealed`.
- `GET /cards/:cardId` — extended: includes a `fundingAccount` sub-object (QE-stripped: alias, bank,
  currency, status, `payoutAccountHasIban`) resolved via port. No CVV.
- `GET /cards?last4=..&bin=..` — plaintext search on the core (last4 equality, BIN prefix).
- `GET /cards?panExact=..` — QE equality search on the vault.
- `GET|PUT /config` — adds `cvvMode` and derivation config (never exposes the CVK).

Built-in `account-information` (`/api/v1/modules/account-information`):
- `GET /accounts/:accountRef/cards` — new (JWT, `accounts:view` + gate): cards by funding account, via
  the Card-by-account port. Display-safe, no CVV.
- `GET /accounts/:accountRef/iban` — new: IBAN reveal for `operations_officer` from the admin panel,
  internal gate, audit `account.iban.revealed`. Ephemeral.

Core PSP (owner self-service, never direct to the module):
- `POST /api/v1/customer/:customerId/cards/:cardId/cvv` — owner reveal via
  `dispatchProvider('card_issuer', 'card.cvv.reveal.requested')`. Owner-only + step-up + audit.
- `POST /api/v1/customer/:customerId/cards/:cardId/pan` — owner PAN reveal via
  `dispatchProvider('card_issuer', 'card.pan.reveal.requested')`. Owner-only + step-up + audit.

Reveal gate decision (F0): `cards:manage` + mandatory audit, no new `viewSensitive` permission
(step-up MFA/SCA in production).

### 15.7 Indexes + setup/seed (single source of truth, R5)

- `vendors/setup/createCollections.ts`: create `cardIssuerVault` (QE collection with its
  `encryptedFieldsMap`); reflect core `paymentCardBin` / `paymentCardLast4` and the removal of the
  persisted `paymentCardMaskedPanDisplay`.
- `vendors/encryption/encryptedFieldsMaps.ts`: PAN (equality) + `cardServiceCode` (equality) for the vault.
- `vendors/encryption/keyVault.ts` / `provisionDEKs.ts`: CVK DEK + `vaultPan` + `vaultServiceCode` DEKs
  (deterministic, idempotent).
- `vendors/setup/createIndexes.ts`: vault indexes on `paymentCardReference` and
  `paymentCardInstanceReference`; core indexes on `paymentCardBin` and `paymentCardLast4` (idempotent).
- `vendors/seed/*`: seed `cardIssuerVault` with the deterministic full PAN (upsert by
  `paymentCardInstanceReference`) and `cardServiceCode`; populate core `bin` / `last4` from that PAN and
  `$unset` the persisted masked; provision the CVK once. Requires a `--reset` + reseed because the QE
  encrypted fields change.

*Added 2026-07-22 (v30). Version 2.4.0.*

---

## §6.13 KYC & KYB Administration API (v31, SD-53 / SD-89)

All under `/api/v1`. KYC administration is owned by the **customer** module (prefix `/customer`),
KYB by the **gateway** module (prefix `/merchants`). The provider (`providers/kyc|kyb`) keeps only
`/score`, `/screen`, `/config`. Administration operates on the domain control records, never on the
provider, so the built-in engine stays swappable.

### Model change: `MerchantBeneficialOwner` (SD-89 + SD-13, FATF/4th AMLD)
Bounded embed on `MerchantAgreementControlRecord.merchantBeneficialOwners: MerchantBeneficialOwner[]`
(cap `MERCHANT_BENEFICIAL_OWNERS_MAX = 25`). Fields: `merchantBeneficialOwnerPartyReference` (FK to party),
`merchantBeneficialOwnerRole` (`ultimate_beneficial_owner|director|shareholder|authorized_signatory`),
`merchantBeneficialOwnerOwnershipPercentage` (0..100, 2 dp), `merchantBeneficialOwnerIsPrimary` (exactly
one true), `merchantBeneficialOwnerIsControllingPerson` (FATF greater-than 25% or board), `AddedDateTime`,
`AddedByPartyReference?`. Invariants enforced in `merchantBeneficialOwner.ts` (length at least 1, one
primary, sum at most 100, primary equals derived scalar `merchantOwnerPartyReference`). Owner PII lives in
`party` (QE tiers), never duplicated in the embed (GDPR Art. 5). The `merchantAgreementProcedure` QE map
is unchanged (merchant is plaintext).

### Structured KYB verdict (entity layer): new `MerchantAgreementKybCheck` fields
`merchantAgreementKybCheckBusinessRiskLevel` (`low|medium|high`), `SanctionsResult`/`AdverseMediaResult`
(`clear|hit|pending`), `ScreeningProviderRef`. Result vocabularies (ADR-009), plaintext, no CHD/QE.
Owner-layer risk is composed by reference from each UBO `customerAgreementKycCheck` (no duplication).

### Decision mode (built-in module config)
New `capabilityModuleConfiguration.moduleConfig` fields for kyc and kyb: `decisionMode`
(`manual|automated|assisted`, unset defaults to manual fail-safe), `decisionAutoApproveMaxRisk` (`low`),
`decisionAutoRejectOn`, `decisionEscalateToManualOn`. The provider never sets the mode. Seeded:
KYC=`automated`, KYB=`manual`. Hard guardrail: a sanctions/PEP hit never auto-approves.

### KYC Administration (customer module)
| Method | Route | Permission | Notes |
|---|---|---|---|
| GET | `/customer/kyc?status=&segment=&riskRating=&page=&limit=` | `customers:view` | Paged list of KYC-completed parties. L1 masked. Index-backed. |
| GET | `/customer/:partyInstanceReference/kyc` | `customers:view` (+`viewSensitive` for L2) | Full detail; sensitive fields masked unless escalation token. |
| PATCH | `/customer/:partyInstanceReference/kyc` | `customers:manage` | Edit occupation/source-of-funds/purpose/govID/address. `amendmentReason` required. Rejects status writes (400). Emits `kyc.record.amended`. |
| POST | `/customer/:partyInstanceReference/kyc/re-screen` | `customers:manage` | Publishes `kyc.screening.requested` on the bus (swappable). |
| GET | `/customer/:partyInstanceReference/kyc/process` | `customers:view` | Correlated timeline (`listAuditEvents({ref})`). |

### KYB Administration (gateway module)
| Method | Route | Permission | Notes |
|---|---|---|---|
| GET | `/merchants/:id/kyb` | `merchants:view` | KYB detail: entity verdict + owners (party summaries) + owner-layer risk. |
| PATCH | `/merchants/:id/kyb` | `merchants:manage` | Edit legal entity/MCC/name/country/notes. `amendmentReason` required. Rejects status writes (400). Emits `kyb.record.amended`. |
| GET | `/merchants/:id/kyb/owners` | `merchants:view` (owner-scoped for customers) | Shareholder list. |
| POST | `/merchants/:id/kyb/owners` | `merchants:manage` | Add owner; invariants enforced. `kyb.owner.added`. |
| PATCH | `/merchants/:id/kyb/owners/:partyRef` | `merchants:manage` | Edit role/pct/primary; primary reassignment atomic. `kyb.owner.amended`/`primary.reassigned`. |
| DELETE | `/merchants/:id/kyb/owners/:partyRef` | `merchants:manage` | Remove; blocked if last or primary. `kyb.owner.removed`. |
| GET | `/merchants/:id/kyb/process` | `merchants:view` | Correlated timeline. |

### KYB onboarding event chain (events only)
`createMerchant` publishes `merchant.validation.requested` on the bus. `ProviderGroups.onMerchantValidated`
fans out `kyb.screening.requested` + `hrp.screening.requested` + `aml.screening.requested` (entity) and
one `kyc.screening.requested` per beneficial owner (owner layer). `KybVerificationSaga` (keyed by
`correlationId = merchantAgreementInstanceReference`) collects the entity completions, composes the
verdict + owner-layer risk, calls `applyKybScreeningVerdict` (sets verdict + BQ:Step status atomically
via the shared `deriveKybCheckStatus` mapper), then resolves the agreement per `decisionMode`
(`resolveKybOnboarding`). Every provider is reached only via `dispatchProvider` (swappable, zero reactor
change to externalize). New event contracts in `onboarding.events.ts`; new canonical ledger milestones
`kyb.screening.completed`/`aml.screening.completed`/`kyb.verification.completed`.

### Status-coherence fix
`applyKycScreeningVerdict` and `applyKybScreeningVerdict` now set the BQ:Step status in the same atomic
update as the verdict, via the shared pure mappers `deriveKycCheckStatus`/`deriveKybCheckStatus`
(`shared/models/onboardingDecision.ts`), so the internal saga path and the external callback path yield
identical status for the same verdict.

### Indexes (createIndexes.ts)
- `merchantAgreementProcedure`: `{ merchantAgreementStatus:1, merchantRiskCategory:1, recordUpdatedDateTime:-1 }`
  (KYB admin list, ESR) and `{ 'merchantBeneficialOwners.merchantBeneficialOwnerPartyReference':1 }` (multikey owner scoping).
- `customerAgreementProcedure`: `{ 'customerAgreementKycCheck.customerAgreementKycCheckStatus':1, recordUpdatedDateTime:-1 }`
  (KYC admin list, ESR; segment is a residual filter so the sort stays index-served whether or not segment is supplied).
All verified with `explain()`: IXSCAN, no COLLSCAN, no blocking SORT.

---

## §10 Module vs Collection Ownership and Access (v31)

Answers the lifecycle questions (switch engine to external / extract module / detect orphans). The
built-in KYC/KYB engines own NO collections (stateless verification ports; only durable state is the
`capabilityModuleConfiguration` row), the "zero-orphan" property of the internal-first pattern.

| Module | Owns (RW) | Reads (RO) | Core-data touch (PCI/GDPR) |
|---|---|---|---|
| `customer` (SD-53 KYC) | `customerAgreementProcedure` | `party`, `complianceProcessEvent` | YES: QE identity fields (govID, address, source of funds); L1/L2 tiers |
| `gateway` (SD-89 KYB) | `merchantAgreementProcedure`, `merchantAgreementEvents` | `party`, `payoutAccountArrangement`, `customerAgreementProcedure` (owner KYC compose), `complianceProcessEvent` | Merchant/UBO PII via `party` refs; legal-entity data (GDPR, not PCI CHD) |
| `identity` (SD-13) | `party` | - | YES: PII owner surface (QE tiers) |
| `provider` (SD-193) | `externalProviderArrangement`, `capabilityModuleConfiguration`, `businessProcessEvent`, `complianceProcessEvent`, `externalProviderArrangementActionLog` | capability registry (code) | NO CHD (SoD: manager) |
| `providers/kyc` (`kyc_identity`) | none (stateless; config in `capabilityModuleConfiguration`) | payload passed by port | NO persistence |
| `providers/kyb` (`kyb_business`) | none (stateless; config in `capabilityModuleConfiguration`) | payload passed by port | NO persistence |

- Q1 (switch internal to external engine): only the module `capabilityModuleConfiguration` row is
  superseded by the `externalProviderArrangement` record; control records + party + audit stay in use, nothing orphaned.
- Q2 (extract module to microservice): stateless engines own no collections, a code-only move; the
  microservice calls back through the port. For kyc/kyb the re-home set is empty (clean extraction).
- Q3 (detect orphans): a collection is a decommission candidate iff no module lists it under Owns/Reads.

*Added 2026-07-24 (v31). Version 2.5.0.*
