# Technical Specification

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-05-26

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

---

## 1. BIAN TypeScript Models

All models live in `backend/src/models/`. Each file exports the TypeScript interface for the collection document and the collection name constant.

### `cardTransaction.model.ts`

```typescript
// BIAN SD-254 — Card Transaction

export const CARD_TRANSACTION_COLLECTION = 'cardTransactionQE';
export const CARD_TRANSACTION_SENSITIVE_COLLECTION = 'cardTransactionSensitiveQE';

export interface CardTransactionLogControlRecord {
  // Identifiers
  cardTransactionInstanceReference: string;       // UUID, primary key
  cardTransactionExternalReference?: string;      // Gateway transaction ID

  // QE equality — searchable encrypted fields
  paymentCardReference: string;                   // Tokenized card ID
  cardTransactionAccountReference: string;        // Account reference

  // Plaintext operational fields
  transactionAmount: {
    amount: number;                               // QE range in v2
    currency: string;                             // ISO 4217
  };
  transactionDateTime: Date;
  transactionStatus: CardTransactionStatus;
  transactionChannel: CardTransactionChannel;
  merchantCategoryCode: string;                   // MCC code
  merchantName: string;
  maskedPanDisplay: string;                       // Display only: ****-****-****-1234

  // BIAN metadata
  bianServiceDomain: 'CardTransaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

export interface CardTransactionSensitiveRecord {
  cardTransactionInstanceReference: string;       // FK — plaintext linking key
  rawGatewayPayload: object;                      // QE none
  processorTransactionMetadata: object;           // QE none
}

export type CardTransactionStatus =
  'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';

export type CardTransactionChannel =
  'online' | 'pos' | 'contactless' | 'atm';
```

### `customerAgreement.model.ts`

```typescript
// BIAN SD-53 — Customer Agreement

export const CUSTOMER_AGREEMENT_COLLECTION = 'customerAgreementQE';
export const CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION = 'customerAgreementSensitiveQE';

export interface CustomerAgreementControlRecord {
  // Identifiers
  customerAgreementInstanceReference: string;    // UUID, primary key

  // QE equality — searchable encrypted fields
  customerEmailAddress: string;
  customerMobilePhoneNumber: string;
  customerAgreementReference: string;            // Account number reference

  // Plaintext fields (v1) — customerName becomes QE equality in v2
  customerName: string;
  customerSegment: CustomerSegment;
  agreementStatus: AgreementStatus;
  enrollmentDateTime: Date;
  preferredLanguage: string;                     // ISO 639-1

  // BIAN metadata
  bianServiceDomain: 'CustomerAgreement';
  bianControlRecordType: 'CustomerAgreement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

export interface CustomerAgreementSensitiveRecord {
  customerAgreementInstanceReference: string;   // FK — plaintext linking key

  // QE none — retrieval only under Level 2 escalation
  residentialAddressFull: ResidentialAddress;
  governmentIdentificationReference: string;
  internalRiskProfileNotes: string;
}

export interface ResidentialAddress {
  streetAddress: string;
  city: string;
  postalCode: string;
  countryCode: string;                           // ISO 3166-1 alpha-2
}

export type CustomerSegment = 'retail' | 'premium' | 'corporate' | 'sme';
export type AgreementStatus = 'active' | 'suspended' | 'closed';
```

### `paymentCard.model.ts`

```typescript
// BIAN SD-88 — Payment Card

export const PAYMENT_CARD_COLLECTION = 'paymentCardQE';

export interface PaymentCardManagementControlRecord {
  // Identifiers
  paymentCardInstanceReference: string;          // UUID, primary key
  customerAgreementInstanceReference: string;    // FK — plaintext linking key

  // QE equality
  paymentCardReference: string;                  // Token (same token as in cardTransactionQE)

  // QE none
  cardExpirationDate: string;                    // MM/YY format

  // Plaintext display fields
  maskedPanDisplay: string;                      // ****-****-****-1234
  cardNetwork: CardNetwork;
  cardStatus: CardStatus;
  cardIssuanceDateTime: Date;
  isPreferredCard: boolean;

  // BIAN metadata
  bianServiceDomain: 'PaymentCard';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type CardStatus = 'active' | 'blocked' | 'expired' | 'pending_activation';
```

### `fraudDiagnosis.model.ts`

```typescript
// BIAN SD-83 — Fraud Diagnosis (no QE — operational metadata only)

export const FRAUD_DIAGNOSIS_COLLECTION = 'fraudDiagnosisCase';

export interface FraudDiagnosisControlRecord {
  // Identifiers
  fraudDiagnosisInstanceReference: string;       // UUID, primary key
  caseReference: string;                         // Human-readable: FD-2026-001234

  // Links to protected records
  linkedCardTransactionReference: string;        // FK to cardTransactionQE
  linkedCustomerAgreementReference: string;      // FK to customerAgreementQE

  // Case workflow
  caseStatus: CaseStatus;
  riskSeverity: RiskSeverity;
  assignedAnalystRole: AnalystRole;
  escalationFlag: boolean;
  escalationDateTime?: Date;
  caseResolutionOutcome?: CaseResolutionOutcome;
  caseNotes: string;

  // Embedded append-only audit log
  diagnosisActionLog: DiagnosisActionEvent[];

  // BIAN metadata
  bianServiceDomain: 'FraudDiagnosis';
  bianControlRecordType: 'FraudDiagnosis';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

export interface DiagnosisActionEvent {
  actionDateTime: Date;
  actionType: ActionType;
  performedByRole: AnalystRole;
  actionDetails: string;
}

export type CaseStatus =
  'open' | 'in_review' | 'escalated' | 'pending_closure' | 'closed';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnalystRole =
  'payment_service' | 'level1_analyst' | 'level2_investigator' | 'security_auditor';

export type ActionType =
  'case_opened' | 'field_accessed' | 'escalated' | 'note_added' | 'case_closed';

export type CaseResolutionOutcome =
  'fraud_confirmed' | 'false_positive' | 'chargeback_initiated' | 'under_review';
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

    // ── cardTransactionQE ──────────────────────────────────────────
    cardTransactionQE: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'paymentCardReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekLookupId,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: add transactionAmount.amount with queryType: 'range'
        // {
        //   keyId: dekLookupId,
        //   path: 'transactionAmount.amount',
        //   bsonType: 'double',
        //   queries: { queryType: 'range', min: 0, max: 999999, precision: 2 },
        // },
      ],
    },

    // ── cardTransactionSensitiveQE ─────────────────────────────────
    cardTransactionSensitiveQE: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'rawGatewayPayload',
          bsonType: 'object',
          // no queries = QE:none — encrypted but not searchable
        },
        {
          keyId: dekSensitiveId,
          path: 'processorTransactionMetadata',
          bsonType: 'object',
        },
      ],
    },

    // ── customerAgreementQE ────────────────────────────────────────
    customerAgreementQE: {
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

    // ── customerAgreementSensitiveQE ───────────────────────────────
    customerAgreementSensitiveQE: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'residentialAddressFull',
          bsonType: 'object',
          // QE:none — no queries
        },
        {
          keyId: dekSensitiveId,
          path: 'governmentIdentificationReference',
          bsonType: 'string',
        },
        {
          keyId: dekSensitiveId,
          path: 'internalRiskProfileNotes',
          bsonType: 'string',
        },
      ],
    },

    // ── paymentCardQE ──────────────────────────────────────────────
    paymentCardQE: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'paymentCardReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekSensitiveId,
          path: 'cardExpirationDate',
          bsonType: 'string',
          // QE:none
        },
      ],
    },

    // fraudDiagnosisCase — no QE, standard collection
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
        [`${process.env.MONGODB_DB_NAME}.cardTransactionQE`]:
          encryptedFieldsMap.cardTransactionQE,
        [`${process.env.MONGODB_DB_NAME}.cardTransactionSensitiveQE`]:
          encryptedFieldsMap.cardTransactionSensitiveQE,
        [`${process.env.MONGODB_DB_NAME}.customerAgreementQE`]:
          encryptedFieldsMap.customerAgreementQE,
        [`${process.env.MONGODB_DB_NAME}.customerAgreementSensitiveQE`]:
          encryptedFieldsMap.customerAgreementSensitiveQE,
        [`${process.env.MONGODB_DB_NAME}.paymentCardQE`]:
          encryptedFieldsMap.paymentCardQE,
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

  await db.collection('cardTransactionQE').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { transactionDateTime: -1 } },
    { key: { transactionStatus: 1 } },
  ]);

  await db.collection('cardTransactionSensitiveQE').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('customerAgreementQE').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { agreementStatus: 1 } },
  ]);

  await db.collection('customerAgreementSensitiveQE').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('paymentCardQE').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { linkedCardTransactionReference: 1 } },
    { key: { caseStatus: 1, riskSeverity: -1 } },
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
  "merchantName": "Online Store Inc.",
  "merchantCategoryCode": "5999",
  "transactionChannel": "online",
  "maskedPanDisplay": "****-****-****-1234",
  "gatewayPayload": { "raw": "..." }
}
```

**Response 201:**
```json
{
  "cardTransactionInstanceReference": "uuid-v4",
  "transactionStatus": "authorized",
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
  "transactionAmount": { "amount": 850.00, "currency": "USD" },
  "transactionDateTime": "2026-05-26T14:30:00Z",
  "transactionStatus": "authorized",
  "merchantName": "Online Store Inc.",
  "merchantCategoryCode": "5999",
  "maskedPanDisplay": "****-****-****-1234"
}
```

---

#### `GET /card-transactions?cardToken=<value>`

QE equality search on `paymentCardReference`.

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
  "agreementStatus": "active"
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
  "cardExpirationDate": "12/28",
  "maskedPanDisplay": "****-****-****-1234",
  "cardNetwork": "VISA",
  "isPreferredCard": false
}
```

**Response 201:**
```json
{
  "paymentCardInstanceReference": "uuid-v4",
  "cardStatus": "active"
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
      "maskedPanDisplay": "****-****-****-1234",
      "cardNetwork": "VISA",
      "cardStatus": "active",
      "isPreferredCard": true
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
  "caseReference": "FD-2026-001234",
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

### 6.7 Health

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
AWS_SESSION_TOKEN=              # Optional — for temporary IAM credentials
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

# ── Frontend (Next.js) ────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001

# ── Demo configuration ────────────────────────────────────────────
FRAUD_AMOUNT_THRESHOLD=500      # Transactions above this create a fraud case
RISK_MCC_LIST=5812,6011,7995    # MCC codes that auto-trigger fraud diagnosis
```

---

## 8. Seed Data Schema

Seed files live in `data/`. The seed script (`bin/seed.ts`) reads each file and performs upsert operations using the collection's primary key as the filter.

### Seed volumes

| File | Collection | Documents |
|---|---|---|
| `data/customerAgreements.json` | `customerAgreementQE` | 50 |
| `data/customerAgreementsSensitive.json` | `customerAgreementSensitiveQE` | 50 |
| `data/paymentCards.json` | `paymentCardQE` | 50 |
| `data/cardTransactions.json` | `cardTransactionQE` | 200 |
| `data/cardTransactionsSensitive.json` | `cardTransactionSensitiveQE` | 200 |
| `data/fraudCases.json` | `fraudDiagnosisCase` | 20 |

### Synthetic data rules

- All personal data (names, emails, phones, addresses) is generated with `@faker-js/faker`
- Card tokens use the format `tok_<uuid>` — never a real card number
- `maskedPanDisplay` format: `****-****-****-XXXX` where XXXX is a random 4-digit suffix
- `cardExpirationDate` is always a future date (at least 12 months from generation)
- CVV, PIN, full PAN, and magnetic stripe data are **never included** in seed files
- Government IDs use a format that is clearly synthetic: `SYNTH-<random-8-digits>`
- Fraud cases are linked to the first 20 transactions (indices 0–19) in the transactions seed

### Upsert key per collection

| Collection | Upsert filter key |
|---|---|
| `customerAgreementQE` | `customerAgreementInstanceReference` |
| `customerAgreementSensitiveQE` | `customerAgreementInstanceReference` |
| `paymentCardQE` | `paymentCardInstanceReference` |
| `cardTransactionQE` | `cardTransactionInstanceReference` |
| `cardTransactionSensitiveQE` | `cardTransactionInstanceReference` |
| `fraudDiagnosisCase` | `fraudDiagnosisInstanceReference` |
