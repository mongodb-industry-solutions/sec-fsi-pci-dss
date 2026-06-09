# Technical Specification

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-06-08

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
  | 'security_auditor';
```

### `customerAgreement.model.ts` (SD-53 — v2 updated)

> **v2 change**: `customerAgreementProcedureSensitive` collection removed. Sensitive QE:none fields are now **inline** in `customerAgreementProcedure`. The QE tier (Level 1 / Level 2 client) controls whether they are returned as Binary or decrypted.

```typescript
// BIAN SD-53: Customer Agreement
// Business contract: account reference, segment, status, and sensitive PII (inline, QE:none).
// PII (email, phone, name) separated to party (SD-13).

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreementProcedure';
// CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION removed in v2

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

  bianServiceDomain: 'Customer Agreement';
  bianControlRecordType: 'CustomerAgreementProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
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
  | 'field_accessed'
  | 'escalated'
  | 'ai_review'
  | 'resolved'
  | 'closed';

export type ResolutionOutcome = 'cleared' | 'confirmed_fraud' | 'referred';
```

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

**Query params:** `status`, `severity`, `page` (default 1), `limit` (default 20)

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
  "diagnosisActionLog": []
}
```

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
  "email": "sarah.chen@leafybank.demo",
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
    "email": "sarah.chen@leafybank.demo",
    "role": "level1_analyst"
  }
}
```

**Response 401:** `{ "error": "Invalid credentials" }`

---

#### `GET /auth/users`

Returns the list of local domain demo users for the login screen dropdown. Data is read from `backend/data/users.json` (seed file) rather than the QE-encrypted collection to avoid decryption overhead on this helper endpoint. Passwords are never included.

**Response 200:**
```json
{
  "users": [
    { "email": "luis.fernandez@leafybank.demo", "name": "Luis Fernandez", "role": "customer" },
    { "email": "julia.santos@leafybank.demo",   "name": "Julia Santos",   "role": "customer" },
    { "email": "sarah.chen@leafybank.demo",     "name": "Sarah Chen",     "role": "level1_analyst" },
    { "email": "michael.obi@leafybank.demo",    "name": "Michael Obi",    "role": "level2_investigator" },
    { "email": "admin@leafybank.demo",          "name": "Admin",          "role": "security_auditor" }
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
| `luis.fernandez@leafybank.demo` | `customer` | Luis Fernandez |
| `julia.santos@leafybank.demo` | `customer` | Julia Santos |
| `sarah.chen@leafybank.demo` | `level1_analyst` | Sarah Chen |
| `michael.obi@leafybank.demo` | `level2_investigator` | Michael Obi |
| `admin@leafybank.demo` | `security_auditor` | Admin |

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
