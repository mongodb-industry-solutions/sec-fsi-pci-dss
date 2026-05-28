# Technical Specification

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-05-28

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

All models live in `backend/src/models/`. Each file exports the TypeScript interface for the collection document and the collection name constant.

### `cardTransaction.model.ts`

```typescript
// BIAN SD-254: Card Transaction

export const CARD_TRANSACTION_COLLECTION = 'cardTransaction';
export const CARD_TRANSACTION_SENSITIVE_COLLECTION = 'cardTransactionSensitive';

export interface CardTransactionLogControlRecord {
  // Identifiers
  cardTransactionInstanceReference: string;       // UUID, primary key
  cardTransactionExternalReference?: string;      // Gateway transaction ID

  // Plaintext: card token is a surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;                   // Indexed plaintext: standard query, not QE

  // QE equality: searchable encrypted fields
  cardTransactionAccountReference: string;        // Account reference

  // Plaintext operational fields
  cardTransactionAmount: {
    amount: number;                               // QE range in v2
    currency: string;                             // ISO 4217
  };
  cardTransactionDateTime: Date;
  cardTransactionStatus: CardTransactionStatus;
  cardTransactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType; // v4: MIT vs CIT for Visa/MC recurring rules
  cardTransactionMerchantCategoryCode: string;    // MCC code
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;        // Display only: ****-****-****-1234

  // BIAN metadata
  bianServiceDomain: 'CardTransaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                           // Schema Versioning Pattern
}

export interface CardTransactionSensitiveRecord {
  cardTransactionInstanceReference: string;       // FK: plaintext linking key
  rawGatewayPayload: object;                      // QE none
  processorTransactionMetadata: object;           // QE none
  schemaVersion: number;
}

export type CardTransactionStatus =
  'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';

export type CardTransactionChannel =
  'online' | 'pos' | 'contactless' | 'atm';

export type CardTransactionInitiationType = 'customerInitiated' | 'merchantInitiated';
```

### `customerAgreement.model.ts`

```typescript
// BIAN SD-53: Customer Agreement

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreement';
export const CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION = 'customerAgreementSensitive';

export interface CustomerAgreementControlRecord {
  // Identifiers
  customerAgreementInstanceReference: string;    // UUID, primary key

  // QE equality: searchable encrypted fields
  customerEmailAddress: string;
  customerMobilePhoneNumber: string;
  customerAgreementReference: string;            // Account number reference

  // Plaintext fields (v1): customerName becomes QE equality in v2
  customerName: string;
  customerSegment: CustomerSegment;
  customerAgreementStatus: CustomerAgreementStatus;
  customerAgreementEnrollmentDate: Date;
  customerAgreementPreferredLanguage: string;     // ISO 639-1

  // v4: recurring payment mandate
  preferredPaymentCardReference?: string;        // FK: paymentCardReference of the saved card

  // BIAN metadata
  bianServiceDomain: 'CustomerAgreement';
  bianControlRecordType: 'CustomerAgreement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                          // Schema Versioning Pattern
}

export interface CustomerAgreementSensitiveRecord {
  customerAgreementInstanceReference: string;   // FK: plaintext linking key

  // QE none: retrieval only under Level 2 escalation
  customerAgreementResidentialAddress: ResidentialAddress;
  governmentIdentificationReference: string;
  customerAgreementRiskNotes: string;
  schemaVersion: number;
}

export interface ResidentialAddress {
  streetAddress: string;
  city: string;
  postalCode: string;
  countryCode: string;                           // ISO 3166-1 alpha-2
}

export type CustomerSegment = 'retail' | 'premium' | 'corporate' | 'sme';
export type CustomerAgreementStatus = 'active' | 'suspended' | 'closed';
```

### `paymentCard.model.ts`

```typescript
// BIAN SD-88: Payment Card

export const PAYMENT_CARD_COLLECTION = 'paymentCard';

export interface PaymentCardManagementControlRecord {
  // Identifiers
  paymentCardInstanceReference: string;          // UUID, primary key
  customerAgreementInstanceReference: string;    // FK: plaintext linking key

  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;                  // Indexed plaintext: standard query, not QE

  // QE none: expiry date is CHD co-located with card reference
  paymentCardExpirationDate: string;             // MM/YY format

  // Plaintext display fields
  paymentCardMaskedPanDisplay: string;           // ****-****-****-1234
  paymentCardNetwork: CardNetwork;
  paymentCardStatus: PaymentCardStatus;
  paymentCardIssuanceDateTime: Date;
  paymentCardIsPreferred: boolean;               // true when saved as preferred payment method

  // v4: recurring payment mandate (PCI DSS Req 3.1 + 3.7)
  paymentCardMandateStatus?: 'active' | 'cancelled' | 'expired';
  paymentCardConsentDateTime?: Date;             // Req 3.1: explicit consent recorded at save-card time
  paymentCardMandateExpiryDate?: Date;           // Req 3.7: auto-purge trigger

  // BIAN metadata
  bianServiceDomain: 'PaymentCard';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
  schemaVersion: number;                          // Schema Versioning Pattern
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type PaymentCardStatus = 'active' | 'blocked' | 'expired' | 'pending_activation';
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

  // Links to protected records (plaintext keys by design: no PII in these refs)
  linkedCardTransactionReference: string;                // FK to cardTransaction
  linkedCustomerAgreementReference: string;              // FK to customerAgreement

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
  fraudDiagnosisAnalystInstanceReference?: string;       // FK to partyAuthentication (L1)
  fraudDiagnosisInvestigatorInstanceReference?: string;  // FK to partyAuthentication (L2)

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

  // AI agent draft (v3: populated by agent, absent if agent disabled)
  agentDraftDiagnosis?: {
    riskSummary: string;
    recommendedAction: 'clear' | 'escalate' | 'investigate';
    confidenceScore: number;                             // 0-100
    supportingEvidence: string[];
    agentCompletionDateTime: Date;
  };

  // BIAN metadata
  bianServiceDomain: 'FraudDiagnosis';
  bianControlRecordType: 'FraudDiagnosis';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;

  // Schema Versioning Pattern: enables zero-downtime schema evolution across v1-v4
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

### `partyAuthentication.model.ts`

```typescript
// BIAN SD-16: Party Authentication (demo-only: stores pre-seeded user accounts)

export const PARTY_AUTHENTICATION_COLLECTION = 'partyAuthentication';

export interface PartyAuthenticationControlRecord {
  // Identifiers
  partyAuthenticationInstanceReference: string;   // UUID, primary key

  // QE equality: searchable by email (login lookup)
  partyAuthenticationUserEmailAddress: string;     // QE:equality: used as username

  // Plaintext fields (hashed credential, not sensitive after hashing)
  partyAuthenticationCredentialHash: string;       // bcrypt hash: never store plaintext
  partyAuthenticationUserRole: DemoUserRole;
  partyAuthenticationUserName: string;             // Display name
  partyAuthenticationLoginDomain: 'local' | 'msentra'; // Identity domain
  partyAuthenticationAccountStatus: 'active' | 'suspended';

  // BIAN metadata
  bianServiceDomain: 'PartyAuthentication';
  bianControlRecordType: 'PartyAuthentication';
  recordCreatedDateTime: Date;
  schemaVersion: number;                          // Schema Versioning Pattern
}

export type DemoUserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor';
```

---

## 2. QE encryptedFieldsMaps

All maps live in `backend/src/encryption/encryptedFieldsMaps.ts`. The `keyId` values are BSON UUIDs resolved at runtime from the provisioned DEKs.

```typescript
// backend/src/encryption/encryptedFieldsMaps.ts

import { Binary } from 'mongodb';

export function buildEncryptedFieldsMaps(
  dekLookupId: Binary,       // DEK-lookup UUID
  dekSensitiveId: Binary     // DEK-sensitive UUID
) {
  return {

    // ── cardTransaction ──────────────────────────────────────────
    // NOTE: paymentCardReference is NOT in QE. A payment token is a card
    // surrogate, not CHD under PCI DSS v4.0. It is stored plaintext and
    // searched via a standard MongoDB index.
    cardTransaction: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: add cardTransactionAmount.amount with queryType: 'range'
        // {
        //   keyId: dekLookupId,
        //   path: 'cardTransactionAmount.amount',
        //   bsonType: 'double',
        //   queries: { queryType: 'range', min: 0, max: 999999, precision: 2 },
        // },
      ],
    },

    // ── cardTransactionSensitive ─────────────────────────────────
    cardTransactionSensitive: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'rawGatewayPayload',
          bsonType: 'object',
          // no queries = QE:none: encrypted but not searchable
        },
        {
          keyId: dekSensitiveId,
          path: 'processorTransactionMetadata',
          bsonType: 'object',
        },
      ],
    },

    // ── customerAgreement ────────────────────────────────────────
    customerAgreement: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'customerEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekLookupId,
          path: 'customerMobilePhoneNumber',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekLookupId,
          path: 'customerAgreementReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: customerName
        // { keyId: dekLookupId, path: 'customerName', bsonType: 'string',
        //   queries: { queryType: 'equality' } },
      ],
    },

    // ── customerAgreementSensitive ───────────────────────────────
    customerAgreementSensitive: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'customerAgreementResidentialAddress',
          bsonType: 'object',
          // QE:none: no queries
        },
        {
          keyId: dekSensitiveId,
          path: 'governmentIdentificationReference',
          bsonType: 'string',
        },
        {
          keyId: dekSensitiveId,
          path: 'customerAgreementRiskNotes',
          bsonType: 'string',
        },
      ],
    },

    // ── paymentCard ──────────────────────────────────────────────
    // NOTE: paymentCardReference is NOT in QE (see cardTransaction note).
    // paymentCardExpirationDate IS protected: expiry date is CHD when co-located with
    // a card reference, and here it travels alongside the token.
    paymentCard: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'paymentCardExpirationDate',
          bsonType: 'string',
          // QE:none — non-searchable, retrieval only
        },
      ],
    },

    // ── partyAuthentication ─────────────────────────────────────
    partyAuthentication: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'partyAuthenticationUserEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },   // login lookup by email
        },
      ],
    },

    // fraudDiagnosisCase: no QE, standard collection
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

```typescript
// backend/src/encryption/client.ts

import { MongoClient } from 'mongodb';
import { buildKmsProviders } from './kms';
import { buildEncryptedFieldsMaps } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

let _client: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (_client) return _client;

  // Step 1: plain client to provision DEKs
  const plainClient = new MongoClient(process.env.MONGODB_URI!);
  await plainClient.connect();

  const { dekLookupId, dekSensitiveId } = await provisionDataEncryptionKeys(plainClient);
  await plainClient.close();

  // Step 2: QE-enabled client
  const encryptedFieldsMap = buildEncryptedFieldsMaps(dekLookupId, dekSensitiveId);

  _client = new MongoClient(process.env.MONGODB_URI!, {
    autoEncryption: {
      keyVaultNamespace: KEY_VAULT_NAMESPACE,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${process.env.MONGODB_DB_NAME}.cardTransaction`]:
          encryptedFieldsMap.cardTransaction,
        [`${process.env.MONGODB_DB_NAME}.cardTransactionSensitive`]:
          encryptedFieldsMap.cardTransactionSensitive,
        [`${process.env.MONGODB_DB_NAME}.customerAgreement`]:
          encryptedFieldsMap.customerAgreement,
        [`${process.env.MONGODB_DB_NAME}.customerAgreementSensitive`]:
          encryptedFieldsMap.customerAgreementSensitive,
        [`${process.env.MONGODB_DB_NAME}.paymentCard`]:
          encryptedFieldsMap.paymentCard,
        [`${process.env.MONGODB_DB_NAME}.partyAuthentication`]:
          encryptedFieldsMap.partyAuthentication,
      },
      // crypt_shared is auto-discovered from node_modules/mongodb-client-encryption
      extraOptions: {
        cryptSharedLibRequired: true,
      },
    },
  });

  await _client.connect();
  return _client;
}
```

---

## 5. Index Creation

```typescript
// bin/setup.ts (relevant section)

import { MongoClient, ClientEncryption } from 'mongodb';

async function createIndexes(client: MongoClient, dbName: string) {
  const db = client.db(dbName);

  await db.collection('cardTransaction').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },             // standard index: token is not QE
    { key: { cardTransactionDateTime: -1 } },
    { key: { cardTransactionStatus: 1 } },
  ]);

  await db.collection('cardTransactionSensitive').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('customerAgreement').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { customerAgreementStatus: 1 } },
  ]);

  await db.collection('customerAgreementSensitive').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('paymentCard').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },             // standard index: token is not QE
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { linkedCardTransactionReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  // fraudDiagnosisCaseEvents: supports ordered audit retrieval per case
  // and filtered queries by actionType (e.g. fetch only escalation events)
  await db.collection('fraudDiagnosisCaseEvents').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1, actionDateTime: -1 } },
    { key: { fraudDiagnosisInstanceReference: 1, actionType: 1 } },
  ]);

  await db.collection('partyAuthentication').createIndexes([
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationUserRole: 1 } },
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

### 6.1 Card Transactions

#### `POST /card-transactions`

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
  "gatewayPayload": { "raw": "..." }
}
```

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

#### `GET /card-transactions/:id`

Returns transaction by ID (no QE field values returned to Level 1).

**Response 200:**
```json
{
  "cardTransactionInstanceReference": "...",
  "cardTransactionAmount": { "amount": 850.00, "currency": "USD" },
  "cardTransactionDateTime": "2026-05-26T14:30:00Z",
  "cardTransactionStatus": "authorized",
  "cardTransactionMerchantName": "Online Store Inc.",
  "cardTransactionMerchantCategoryCode": "5999",
  "cardTransactionMaskedPanDisplay": "****-****-****-1234"
}
```

---

#### `GET /card-transactions?cardToken=<value>`

Standard index query on `paymentCardReference` (plaintext field: token is a card surrogate, not CHD under PCI DSS v4.0).

**Response 200:**
```json
{
  "results": [ /* CardTransactionLogControlRecord[] */ ],
  "count": 3
}
```

---

### 6.2 Customer Agreements

#### `GET /customer-agreements?email=<value>`
#### `GET /customer-agreements?phone=<value>`
#### `GET /customer-agreements?accountRef=<value>`

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

### 6.3 Payment Cards

#### `POST /payment-cards`

Registers a tokenized card linked to a customer agreement.

**Request body:**
```json
{
  "customerAgreementInstanceReference": "uuid-v4",
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

#### `GET /payment-cards?customerRef=<customerAgreementInstanceReference>`

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

### 6.4 Fraud Diagnosis Cases

#### `GET /fraud-diagnosis-cases`

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

#### `GET /fraud-diagnosis-cases/:id`

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

#### `POST /fraud-diagnosis-cases/:id/escalate` *(v2)*

**Request header:** `X-Demo-Role: level1_analyst`

**Response 200:**
```json
{
  "fraudDiagnosisInstanceReference": "...",
  "caseStatus": "escalated",
  "escalationDateTime": "2026-05-26T15:00:00Z"
}
```

---

### 6.5 Audit Events *(v2)*

#### `GET /audit-events?caseId=<id>`

**Response 200:**
```json
{
  "caseId": "...",
  "events": [
    {
      "actionDateTime": "2026-05-26T14:35:00Z",
      "actionType": "case_opened",
      "performedByRole": "payment_service",
      "actionDetails": "Fraud case auto-created on authorization"
    }
  ]
}
```

---

### 6.6 Diagnostics *(v3)*

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

Validates credentials against `partyAuthentication` (QE equality search on email). Returns a signed JWT on success.

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
    "partyAuthenticationInstanceReference": "uuid-v4",
    "name": "Sarah Chen",
    "email": "sarah.chen@leafybank.demo",
    "role": "level1_analyst"
  }
}
```

**Response 401:** `{ "error": "Invalid credentials" }`

---

#### `GET /auth/users`

Returns the list of demo users for the login screen dropdown. Passwords are never included.

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

### 6.8 Raw Document (Demo Tool)

Available only when `NODE_ENV !== 'production'`. Used by the "Encrypted in Atlas" toggle in both modes.

#### `GET /demo/raw-document/:collection/:id`

Returns the raw BSON document as stored in Atlas (ciphertext visible, no auto-decryption). Uses a plain MongoClient without `autoEncryption`.

**Path params:** `collection` (e.g., `cardTransaction`), `id` (document `_id` or primary key value)

**Response 200:**
```json
{
  "collection": "cardTransaction",
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

#### `GET /health`

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
# .env.example

# ── MongoDB Atlas ─────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=pci_dss_demo

# ── AWS KMS ───────────────────────────────────────────────────────
# Required when KMS_PROVIDER=aws (default)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=              # Optional: for temporary IAM credentials
AWS_REGION=us-east-1
AWS_CMK_ARN=arn:aws:kms:us-east-1:<account>:key/<key-id>

# ── KMS provider selection ────────────────────────────────────────
KMS_PROVIDER=aws                # 'aws' | 'local'

# ── Local KMS (offline / docker-compose dev only) ─────────────────
# Generate with: node -e "require('crypto').randomBytes(96).toString('base64')"
LOCAL_MASTER_KEY_BASE64=

# ── Backend (Fastify) ─────────────────────────────────────────────
API_PORT=3001
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:3000

# ── Authentication (Application Mode) ────────────────────────────
# Generate with: node -e "require('crypto').randomBytes(32).toString('hex')"
JWT_SECRET=
JWT_EXPIRES_IN=24h
AUTH_DOMAIN=local               # 'local' | 'msentra' (msentra: v2)

# ── Frontend (Next.js) ────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001

# ── Demo configuration ────────────────────────────────────────────
FRAUD_AMOUNT_THRESHOLD=500      # Transactions above this create a fraud case
RISK_MCC_LIST=5812,6011,7995    # MCC codes that auto-trigger fraud diagnosis

# ── AI Agent (v3) ─────────────────────────────────────────────────
AGENT_ENABLED=false             # 'true' | 'false': set true to enable v3 agent
MAGENTA_API_KEY=                # MongoDB Agentic Platform (Magenta) API key
```

---

## 8. Seed Data Schema

Seed files live in `backend/data/`. The seed script (`backend/bin/seed.ts`) reads each file and performs upsert operations using the collection's primary key as the filter.

### Seed volumes

| File | Collection | Documents |
|---|---|---|
| `backend/data/users.json` | `partyAuthentication` | 5 |
| `backend/data/customerAgreements.json` | `customerAgreement` | 50 |
| `backend/data/customerAgreementsSensitive.json` | `customerAgreementSensitive` | 50 |
| `backend/data/paymentCards.json` | `paymentCard` | 50 |
| `backend/data/cardTransactions.json` | `cardTransaction` | 200 |
| `backend/data/cardTransactionsSensitive.json` | `cardTransactionSensitive` | 200 |
| `backend/data/fraudCases.json` | `fraudDiagnosisCase` | 20 |

### Demo users (`data/users.json`)

Passwords are stored as bcrypt hashes (12 rounds). Plaintext passwords are in `.env.example` comments for demo convenience only.

| Email | Role | Display Name |
|---|---|---|
| `luis.fernandez@leafybank.demo` | `customer` | Luis Fernandez |
| `julia.santos@leafybank.demo` | `customer` | Julia Santos |
| `sarah.chen@leafybank.demo` | `level1_analyst` | Sarah Chen |
| `michael.obi@leafybank.demo` | `level2_investigator` | Michael Obi |
| `admin@leafybank.demo` | `security_auditor` | Admin |

### Synthetic data rules

- All personal data (names, emails, phones, addresses) is generated with `@faker-js/faker`
- Card tokens use the format `tok_<uuid>`: never a real card number
- `paymentCardMaskedPanDisplay` / `cardTransactionMaskedPanDisplay` format: `****-****-****-XXXX` where XXXX is a random 4-digit suffix
- `paymentCardExpirationDate` is always a future date (at least 12 months from generation)
- CVV, PIN, full PAN, and magnetic stripe data are **never included** in seed files
- Government IDs use a format that is clearly synthetic: `SYNTH-<random-8-digits>`
- Fraud cases are linked to the first 20 transactions (indices 0–19) in the transactions seed

### Upsert key per collection

| Collection | Upsert filter key |
|---|---|
| `partyAuthentication` | `partyAuthenticationInstanceReference` |
| `customerAgreement` | `customerAgreementInstanceReference` |
| `customerAgreementSensitive` | `customerAgreementInstanceReference` |
| `paymentCard` | `paymentCardInstanceReference` |
| `cardTransaction` | `cardTransactionInstanceReference` |
| `cardTransactionSensitive` | `cardTransactionInstanceReference` |
| `fraudDiagnosisCase` | `fraudDiagnosisInstanceReference` |

---

## 9. Backend Source Structure

```
backend/
├── bin/
│   ├── setup.ts                         # Calls src/vendors/setup/runSetup()
│   └── seed.ts                          # Calls src/vendors/seed/runSeed()
├── data/                                # JSON seed files (consumed by bin/seed.ts only)
│   ├── users.json
│   ├── customerAgreements.json
│   ├── customerAgreementsSensitive.json
│   ├── paymentCards.json
│   ├── cardTransactions.json
│   ├── cardTransactionsSensitive.json
│   └── fraudCases.json
├── src/
├── controllers/
│   ├── auth.controller.ts
│   ├── cardTransaction.controller.ts
│   ├── customerAgreement.controller.ts
│   ├── paymentCard.controller.ts
│   ├── fraudDiagnosis.controller.ts
│   └── demo.controller.ts               # Raw document endpoint (non-prod only)
│
├── services/
│   ├── auth.service.ts                  # JWT sign/verify, bcrypt compare
│   ├── cardTransaction.service.ts
│   ├── customerAgreement.service.ts
│   ├── paymentCard.service.ts
│   └── fraudDiagnosis.service.ts
│
├── models/
│   ├── partyAuthentication.model.ts     # BIAN SD-16
│   ├── cardTransaction.model.ts         # BIAN SD-254
│   ├── customerAgreement.model.ts       # BIAN SD-53
│   ├── paymentCard.model.ts             # BIAN SD-88
│   └── fraudDiagnosis.model.ts          # BIAN SD-83
│
├── vendors/
│   ├── encryption/
│   │   ├── qeClient.ts                  # MongoClient with autoEncryption
│   │   ├── rawClient.ts                 # Plain MongoClient (no decryption)
│   │   ├── kms.ts                       # buildKmsProviders(), buildCmkOptions()
│   │   ├── keyVault.ts                  # provisionDataEncryptionKeys()
│   │   └── encryptedFieldsMaps.ts       # buildEncryptedFieldsMaps()
│   ├── setup/
│   │   ├── index.ts                     # runSetup(): orchestrates all setup steps
│   │   ├── createCollections.ts         # createEncryptedCollection() calls
│   │   ├── createIndexes.ts             # all index definitions
│   │   └── provisionDEKs.ts             # DEK-lookup + DEK-sensitive
│   └── seed/
│       ├── index.ts                     # runSeed(): orchestrates all seed steps
│       ├── seedUsers.ts                 # partyAuthentication upserts
│       ├── seedCustomers.ts             # customerAgreement + sensitive upserts
│       ├── seedCards.ts                 # paymentCard upserts
│       ├── seedTransactions.ts          # cardTransaction + sensitive upserts
│       └── seedCases.ts                 # fraudDiagnosisCase upserts
│
├── middleware/
│   ├── auth.ts                          # JWT verification: reads Authorization header
│   └── rbac.ts                          # Role enforcement: gates sensitive collections
│
├── plugins/
│   ├── mongodb.ts                       # Fastify plugin: registers QE client
│   └── cors.ts
│
└── server.ts                            # Fastify app setup + route registration
```

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
    "setup:db": "npm run setup:db --prefix backend",
    "seed":     "npm run seed --prefix backend"
  }
}
```
