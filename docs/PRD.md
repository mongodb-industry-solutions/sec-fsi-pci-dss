# PRD: FSI PCI DSS Payment Security Demo

| Field | Value |
|---|---|
| **Version** | 1.1 |
| **Status** | Active |
| **Author** | Antonio Membrides Espinosa |
| **Date** | 2026-06-05 |
| **Repository** | sec-fsi-pci-dss |
| **Demo Type** | IST Standalone Demo: FSI / Security |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Solution Overview](#3-solution-overview)
4. [Target Audience & Personas](#4-target-audience--personas)
5. [Demo Storyline](#5-demo-storyline)
6. [BIAN Data Architecture](#6-bian-data-architecture)
7. [Queryable Encryption Design](#7-queryable-encryption-design)
8. [Technical Architecture](#8-technical-architecture)
9. [Product Roadmap](#9-product-roadmap)
10. [Feature Requirements](#10-feature-requirements)
11. [PCI DSS Alignment](#11-pci-dss-alignment)
12. [Q&A Coverage Matrix](#12-qa-coverage-matrix)
13. [Installation & DevOps](#13-installation--devops)
14. [Success Metrics](#14-success-metrics)
15. [Open Questions & Decisions Log](#15-open-questions--decisions-log)

**Related documents:**
- [Roadmap: FR & NFR per iteration](roadmap.md)
- [Technical Specification](technical-spec.md)
- [Engineering Proposal](engineering-proposal.md)

---

## 1. Executive Summary

This demo showcases MongoDB as a **PCI DSS-aligned data platform** for financial institutions. It demonstrates how a digital bank or card issuer can simulate a complete card payment lifecycle: from checkout to fraud investigation: while keeping sensitive cardholder data encrypted end-to-end using **MongoDB Queryable Encryption (QE)** with **AWS KMS**, all structured according to **BIAN (Banking Industry Architecture Network)** Service Domain naming conventions.

The demo answers the most critical question FSI prospects ask:

> *"How can we keep payment data fully encrypted and still perform fraud investigations at operational speed?"*

**Core MongoDB capability demonstrated:** Queryable Encryption (QE): encrypt fields client-side, query them without server-side decryption, with keys managed by the customer in AWS KMS.

**Regulatory framework:** PCI DSS v4.0 aligned architecture  
**Data architecture standard:** BIAN Service Domains  
**Delivery model:** Standalone demo, designed for future integration with Leafy Bank

---

## 2. Problem Statement

### Business Problem

Banks and payment providers must investigate suspicious transactions in minutes, not hours. Traditional architectures force a trade-off: either expose sensitive payment data to internal systems for operability, or lock it down so tightly that fraud teams cannot function.

This creates three compounding risks:

1. **PCI scope expansion**: Storing or transmitting cardholder data in plaintext across internal systems brings every component into PCI DSS scope.
2. **Insider threat exposure**: Database administrators, support tooling, and logging pipelines see cardholder data they should not.
3. **Investigative friction**: Encrypted data that cannot be queried forces teams to decrypt entire datasets, which defeats the purpose of encryption.

### Why MongoDB and Why Now

PCI DSS v4.0 (effective March 2025) increases requirements for encryption, cryptographic key management, and data minimization. MongoDB Atlas achieved PCI DSS 4.0 certification in September 2023.

MongoDB's **Queryable Encryption** solves the trade-off: fields are encrypted **before** reaching the server. The server never sees plaintext. Yet applications can still run equality and range queries on ciphertext using client-side metadata: without server-side decryption.

This is the only capability on the market that allows a fraud analyst to search `customerEmailAddress = "john@bank.com"` while that field is stored as an encrypted blob on the database server.

---

## 3. Solution Overview

### Concept

A synthetic digital bank (standalone, Leafy Bank-ready) exposes two entry points:

- **Simulator Mode:** Story-driven, no login, presenter-controlled. A narrator follows Luis (customer) from checkout through fraud investigation. All perspectives are visible in one session. Designed for a 10-minute live demo to CISO or sales audience.
- **Application Mode:** Real JWT login, role-based routing. Each user logs in and sees only their role's view (customer, L1 analyst, L2 investigator, security auditor). Designed for hands-on technical evaluation and POC walkthroughs.

Both modes share the same backend API and the same MongoDB Atlas data. The frontend routes and UX differ; the encryption, QE queries, and RBAC enforcement are identical.

A synthetic digital bank (standalone, Leafy Bank-ready) runs a payment flow where sensitive cardholder data is encrypted client-side before it reaches MongoDB Atlas. A fraud or compliance event triggers an investigation case. Analysts query encrypted fields to locate records. Role-based access controls determine which fields are revealed and under what conditions.

### Architecture Principles

| Principle | Application |
|---|---|
| **Data minimization** | Full PAN, CVV, and PIN are never stored. Only tokenized card references and masked PAN for display. |
| **Encryption at origin** | QE encrypts fields in the application layer before the MongoDB driver sends data to Atlas. |
| **Least privilege** | Each service role has a distinct MongoDB Atlas database user with scoped QE key access. |
| **BIAN alignment** | Collections, field names, and relationships follow BIAN Service Domain vocabulary. |
| **Customer-controlled keys** | AWS KMS manages the Customer Master Key (CMK). MongoDB never has key access. |
| **Simplicity first** | Each iteration delivers runnable, explainable results. No half-implemented features reach staging. |

### MongoDB Features Demonstrated

| Feature | Purpose in Demo |
|---|---|
| Queryable Encryption: equality | Search encrypted email, phone, and account reference (PII fields) |
| Queryable Encryption: range (v2) | Search by encrypted transaction amount band |
| Queryable Encryption: none mode | Protect sensitive PII (address, government ID) that only escalated roles see |
| AWS KMS integration | Customer-controlled key management, key rotation simulation |
| Atlas RBAC | Role-based collection and field access per analyst persona |
| Database Auditing | Trace every access event to encrypted fields |
| TLS 1.3 default | Wire encryption for all Atlas connections |
| Private Endpoint (documented) | Network isolation architecture pattern shown in diagrams |

---

## 4. Target Audience & Personas

### Primary Demo Audience

| Persona | Role | What They Need to See |
|---|---|---|
| **CISO / Security Architect** | Evaluates security controls, compliance posture, key management | QE technical depth, AWS KMS integration, PCI DSS requirement mapping, audit trail |
| **Sales / Pre-sales (AE/SE)** | Runs the demo live, builds the narrative | Clear visual story, explainable flow, 10-minute walkthrough path, talking points |

### Demo Internal Personas (roles within the demo itself)

| Persona | Access Level | Actions Available |
|---|---|---|
| **Payment Service** | Write: Card Transaction SD, Customer Agreement SD | Submit card payment, encrypt fields |
| **Level 1 Analyst** | Read: equality QE fields only | Search by email (QE), phone (QE), account ref (QE); card token search via standard index |
| **Level 2 Investigator** | Read: equality + `none` mode QE fields | Full record reveal after escalation approval |
| **Security Auditor** | Read: audit log, case history only | Review access events, export case timeline |

---

## 5. Demo Storyline

### Narrative Arc

```
[1. Customer Checkout]
   Customer pays with a credit card on the digital banking app.
   Sensitive fields are encrypted by the client before reaching MongoDB Atlas.
   The payment card token is stored: never the full PAN, CVV, or PIN.

        ↓

[2. Fraud Alert Triggered]
   A Financial Transaction Assessment flags the payment as suspicious:
   unusual merchant category, different country, rapid-succession transactions.
   A Fraud Diagnosis Case is automatically created.

        ↓

[3. Level 1 Investigation]
   Analyst searches by encrypted email or account reference.
   MongoDB returns the matching record: the server never decrypted the field.
   The UI reveals: transaction metadata, masked PAN, merchant info.
   Sensitive fields (address, government ID) remain encrypted and hidden.

        ↓

[4. Escalation (v2)]
   Analyst escalates the case to Level 2.
   The escalation workflow authenticates the investigator's role.
   The application decrypts QE-none fields (address, government ID) client-side.
   An audit event is written to the Atlas audit log.

        ↓

[5. Case Resolution]
   Investigator marks the transaction as confirmed fraud or false positive.
   Case status updates. Audit trail is complete and exportable.
```

### Key Demo Moments (Explainability)

1. **"Watch the wire"**: Show the raw MongoDB document in Atlas Data Explorer. The encrypted fields are opaque ciphertext blobs. The analyst found the record without the server ever seeing plaintext.
2. **"Same query, different privilege"**: Run the same search as Level 1 and Level 2. Level 2 sees additional fields decrypted. Same encrypted document in Atlas; different application-layer key access.
3. **"Keys are yours"**: Open the AWS KMS console. Show the Customer Master Key. MongoDB has zero access to it.

---

## 6. BIAN Data Architecture

### 6.1 Why BIAN

BIAN (Banking Industry Architecture Network) provides a standardized vocabulary for banking business capabilities. Using BIAN naming for collections and fields immediately communicates credibility to FSI architects and compliance teams. It also ensures the demo data model is extensible into broader banking scenarios (Leafy Bank integration, future SDs).

### 6.2 BIAN Service Domains in Scope

#### v1–v4: Core demo SDs (currently implemented)

| # | BIAN Service Domain | SD Reference | Role in Demo | Collection | Version |
|---|---|---|---|---|---|
| 1 | **Card Transaction** | SD-254 | Records card payment events | `cardTransaction` | v1 |
| 2 | **Card Transaction: Sensitive** | SD-254 (sensitive) | Stores non-searchable gateway payload | `cardTransactionSensitive` | v1 |
| 3 | **Customer Agreement** | SD-53 | Customer profile, searchable PII | `customerAgreement` | v1 |
| 4 | **Customer Agreement: Sensitive** | SD-53 (sensitive) | Non-searchable PII (address, gov ID) | `customerAgreementSensitive` | v1 |
| 5 | **Payment Card** | SD-88 | Stored card instruments (tokens) | `paymentCard` | v1 |
| 6 | **Fraud Diagnosis** | SD-83 | Investigation cases and workflow | `fraudDiagnosisCase` | v1 |
| 7 | **Party Authentication** | SD-16 | Demo user accounts, roles, hashed credentials | `partyAuthentication` | v1 |

#### v5: Payment Gateway SDs (new)

| # | BIAN Service Domain | SD Reference | Role in Demo | Collection | Version |
|---|---|---|---|---|---|
| 8 | **Merchant Relations** | SD-89 | Merchant profile, MCC, limits, API key | `merchantAgreement` | v5 |
| 9 | **Payment Order** | SD-64 | Payment intent lifecycle (initiated → settled) | `paymentOrder` | v5 |
| 10 | **Payment Execution** | SD-65 | Gateway routing and authorization orchestration | *(service layer, no dedicated collection)* | v5 |
| 11 | **Card Etoken** | SD-57 | Token vault: card token references and network tokens | `tokenVault` | v5 |

> **Note 1:** BIAN does not define separate "sensitive" collections; the split is an architectural pattern for separating searchable QE fields from non-searchable QE fields, as required by MongoDB QE design constraints.
>
> **Note 2:** `partyAuthentication` is a demo-only construct. It stores pre-seeded user accounts (email, bcrypt password hash, role) to support Application Mode login. In a production FSI system, authentication would be delegated to an identity provider (e.g., MS Entra ID). The `partyAuthentication` collection uses QE equality on `authenticationUserEmailAddress` to demonstrate that even user credential lookups can be encrypted.
>
> **Note 3 (v5):** The backend module structure mirrors the BIAN SD grouping. Each module owns the collections, services, and API routes for its assigned SDs. See [engineering-proposal.md §3.8](engineering-proposal.md) for the full BIAN Module Map.

### 6.3 Collection Schemas

#### Collection 1: `cardTransaction`
*BIAN SD-254: Card Transaction Log Control Record*

```typescript
interface CardTransactionLogControlRecord {
  // Identifiers (plaintext)
  cardTransactionInstanceReference: string;       // primary key, UUID
  cardTransactionExternalReference?: string;      // gateway transaction ID

  // Plaintext: payment token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;                   // indexed plaintext: standard query, not QE

  // Encrypted: QE equality (searchable)
  cardTransactionAccountReference: string;        // QE:equality: account reference

  // Transaction metadata (plaintext)
  transactionAmount: {
    amount: number;                               // QE:range in v2
    currency: string;                             // ISO 4217
  };
  transactionDateTime: Date;
  transactionStatus: 'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
  transactionChannel: 'online' | 'pos' | 'contactless' | 'atm';
  merchantCategoryCode: string;                   // MCC code (plaintext)
  merchantName: string;                           // plaintext
  maskedPanDisplay: string;                       // plaintext: display only: ****-****-****-1234

  // BIAN metadata
  bianServiceDomain: 'CardTransaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}
```

#### Collection 2: `cardTransactionSensitive`
*BIAN SD-254: Sensitive / Non-searchable attributes*

```typescript
interface CardTransactionSensitiveRecord {
  // Linking key (plaintext by policy)
  cardTransactionInstanceReference: string;       // FK to cardTransaction

  // Encrypted: QE none (non-searchable, retrieval only under Level 2)
  rawGatewayPayload: object;                      // QE:none: full gateway response
  processorTransactionMetadata: object;           // QE:none: processor-specific metadata

  // NEVER store:
  // fullPan, cvv, pin, magneticStripeData: prohibited by PCI DSS SAD rules
}
```

#### Collection 3: `customerAgreement`
*BIAN SD-53: Customer Agreement Control Record (searchable PII)*

```typescript
interface CustomerAgreementControlRecord {
  // Identifiers (plaintext)
  customerAgreementInstanceReference: string;    // primary key, UUID

  // Encrypted: QE equality (searchable by Level 1+)
  customerEmailAddress: string;                  // QE:equality
  customerMobilePhoneNumber: string;             // QE:equality
  customerAgreementReference: string;            // QE:equality: account number reference

  // Display fields (plaintext: non-sensitive)
  customerName: string;                          // plaintext in v1; QE:equality in v2
  customerSegment: 'retail' | 'premium' | 'corporate' | 'sme';
  agreementStatus: 'active' | 'suspended' | 'closed';
  enrollmentDateTime: Date;
  preferredLanguage: string;                     // ISO 639-1

  // BIAN metadata
  bianServiceDomain: 'CustomerAgreement';
  bianControlRecordType: 'CustomerAgreement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}
```

#### Collection 4: `customerAgreementSensitive`
*BIAN SD-53: Non-searchable PII (escalation-only access)*

```typescript
interface CustomerAgreementSensitiveRecord {
  // Linking key (plaintext by policy)
  customerAgreementInstanceReference: string;   // FK to customerAgreement

  // Encrypted: QE none (non-searchable, Level 2 escalation only)
  residentialAddressFull: {                      // QE:none
    streetAddress: string;
    city: string;
    postalCode: string;
    countryCode: string;
  };
  governmentIdentificationReference: string;    // QE:none: national ID / passport
  internalRiskProfileNotes: string;             // QE:none: internal fraud notes
}
```

#### Collection 5: `paymentCard`
*BIAN SD-88: Payment Card Management Control Record*

```typescript
interface PaymentCardManagementControlRecord {
  // Identifiers (plaintext)
  paymentCardInstanceReference: string;          // primary key, UUID
  customerAgreementInstanceReference: string;    // FK to customerAgreement (plaintext)

  // Plaintext: payment token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;                  // indexed plaintext: standard query, not QE

  // Encrypted: QE none (non-searchable)
  cardExpirationDate: string;                    // QE:none: MM/YY format — CHD co-located with card reference

  // Display fields (plaintext: non-sensitive)
  maskedPanDisplay: string;                      // ****-****-****-1234
  cardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
  cardStatus: 'active' | 'blocked' | 'expired' | 'pending_activation';
  cardIssuanceDateTime: Date;
  isPreferredCard: boolean;

  // BIAN metadata
  bianServiceDomain: 'PaymentCard';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
}
```

#### Collection 6: `fraudDiagnosisCase`
*BIAN SD-83: Fraud Diagnosis Control Record (no QE: operational metadata)*

```typescript
interface FraudDiagnosisControlRecord {
  // Identifiers (plaintext)
  fraudDiagnosisInstanceReference: string;       // primary key, UUID
  caseReference: string;                         // human-readable case number: FD-2026-001234

  // Links to protected records (plaintext keys by design)
  linkedCardTransactionReference: string;        // FK to cardTransaction
  linkedCustomerAgreementReference: string;      // FK to customerAgreement

  // Case workflow (plaintext)
  caseStatus: 'open' | 'in_review' | 'escalated' | 'pending_closure' | 'closed';
  riskSeverity: 'low' | 'medium' | 'high' | 'critical';
  assignedAnalystRole: 'level1_analyst' | 'level2_investigator';
  escalationFlag: boolean;
  escalationDateTime?: Date;
  caseResolutionOutcome?: 'fraud_confirmed' | 'false_positive' | 'chargeback_initiated' | 'under_review';
  caseNotes: string;                             // non-sensitive operational notes

  // Audit log (embedded: append-only)
  diagnosisActionLog: Array<{
    actionDateTime: Date;
    actionType: 'case_opened' | 'field_accessed' | 'escalated' | 'note_added' | 'case_closed';
    performedByRole: string;
    actionDetails: string;
  }>;

  // BIAN metadata
  bianServiceDomain: 'FraudDiagnosis';
  bianControlRecordType: 'FraudDiagnosis';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}
```

### 6.4 Collection Relationships

```
partyAuthentication ─────────────────────────────────────────────────────────────────
        │ (demo user accounts: login maps to role)
        │
customerAgreement ──────────────── 1 : 1 ──────────────── customerAgreementSensitive
        │                               via: customerAgreementInstanceReference
        │
        │ 1 : many
        ↓
paymentCard ──────────────────────────────────────────────────────────────────────────
        │ (via paymentCardReference token)
        │ many : 1
        ↓
cardTransaction ─────────────────── 1 : 1 ──────────────── cardTransactionSensitive
        │                               via: cardTransactionInstanceReference
        │
        │ 1 : many
        ↓
fraudDiagnosisCase ─── also links to ──► customerAgreement
        (via linkedCardTransactionReference + linkedCustomerAgreementReference)
```

**Join strategy:** Application-side joins only. No `$lookup` across QE collections (not supported for encrypted fields). The API service performs sequential queries and assembles the response.

### 6.5 Index Strategy

| Collection | Index | Type | Purpose |
|---|---|---|---|
| `cardTransaction` | `cardTransactionInstanceReference` | Unique | Primary lookup |
| `cardTransaction` | `transactionDateTime` | Single field | Time-range filtering |
| `cardTransaction` | `transactionStatus` | Single field | Status filtering |
| `cardTransactionSensitive` | `cardTransactionInstanceReference` | Unique | 1:1 join |
| `customerAgreement` | `customerAgreementInstanceReference` | Unique | Primary lookup |
| `customerAgreement` | `agreementStatus` | Single field | Active customer filtering |
| `customerAgreementSensitive` | `customerAgreementInstanceReference` | Unique | 1:1 join |
| `paymentCard` | `paymentCardInstanceReference` | Unique | Primary lookup |
| `paymentCard` | `paymentCardReference` | Single field | Token lookup (standard index: not QE) |
| `paymentCard` | `customerAgreementInstanceReference` | Single field | Cards by customer |
| `cardTransaction` | `paymentCardReference` | Single field | Transactions by token (standard index: not QE) |
| `fraudDiagnosisCase` | `fraudDiagnosisInstanceReference` | Unique | Primary lookup |
| `fraudDiagnosisCase` | `linkedCardTransactionReference` | Single field | Case by transaction |
| `fraudDiagnosisCase` | `caseStatus, riskSeverity` | Compound | Dashboard filtering |
| `partyAuthentication` | `partyAuthenticationInstanceReference` | Unique | Primary lookup |
| `partyAuthentication` | `authenticationUserRole` | Single field | User list by role |

> QE encrypted fields (`paymentCardReference`, `customerEmailAddress`, etc.) use QE metadata indexes automatically managed by the driver: do not create manual indexes on these fields.

---

## 7. Queryable Encryption Design

### 7.1 QE Field Classification Table

| Field | BIAN SD | PCI Classification | QE Mode | Collection | Demo Version |
|---|---|---|---|---|---|
| `paymentCardReference` | Card Transaction | **Card surrogate: not CHD under PCI DSS v4.0** | **plaintext (indexed)** | `cardTransaction` | v1 |
| `cardTransactionAccountReference` | Card Transaction | CHD-adjacent | `equality` | `cardTransaction` | v1 |
| `customerEmailAddress` | Customer Agreement | PII | `equality` | `customerAgreement` | v1 |
| `customerMobilePhoneNumber` | Customer Agreement | PII | `equality` | `customerAgreement` | v1 |
| `customerAgreementReference` | Customer Agreement | CHD-adjacent | `equality` | `customerAgreement` | v1 |
| `paymentCardReference` | Payment Card | **Card surrogate: not CHD under PCI DSS v4.0** | **plaintext (indexed)** | `paymentCard` | v1 |
| `cardExpirationDate` | Payment Card | CHD | `none` | `paymentCard` | v1 |
| `rawGatewayPayload` | Card Transaction | Internal | `none` | `cardTransactionSensitive` | v1 |
| `processorTransactionMetadata` | Card Transaction | Internal | `none` | `cardTransactionSensitive` | v1 |
| `residentialAddressFull` | Customer Agreement | PII | `none` | `customerAgreementSensitive` | v1 |
| `governmentIdentificationReference` | Customer Agreement | PII | `none` | `customerAgreementSensitive` | v1 |
| `internalRiskProfileNotes` | Customer Agreement | Internal | `none` | `customerAgreementSensitive` | v1 |
| `transactionAmount.amount` | Card Transaction |: | `range` | `cardTransaction` | **v2** |
| `customerName` | Customer Agreement | CHD | `equality` | `customerAgreement` | **v2** |
| **`fullPan`** |: | CHD: **PROHIBITED** | **never store** |: |: |
| **`cvv` / `pin`** |: | SAD: **PROHIBITED** | **never store** |: |: |
| **`magneticStripeData`** |: | SAD: **PROHIBITED** | **never store** |: |: |

### 7.2 Key Management Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS KMS                              │
│  Customer Master Key (CMK)                              │
│  arn:aws:kms:<region>:<account>:key/<key-id>            │
│                         ↑                               │
│              Customer controls, MongoDB has NO access   │
└──────────────────────────┬──────────────────────────────┘
                           │ wraps / unwraps
┌──────────────────────────▼──────────────────────────────┐
│              MongoDB Key Vault Collection               │
│  Database: encryption   Collection: __keyVault          │
│                                                         │
│  Key Vault documents:                                   │
│  ├── DEK-lookup   (for equality-searchable collections) │
│  └── DEK-sensitive (for QE:none sensitive collections)  │
└──────────────────────────┬──────────────────────────────┘
                           │ encrypts fields
┌──────────────────────────▼──────────────────────────────┐
│                 MongoDB Atlas Cluster                   │
│                                                         │
│  cardTransaction        ← DEK-lookup                  │
│  customerAgreement      ← DEK-lookup                  │
│  paymentCard            ← DEK-lookup                  │
│  cardTransactionSensitive ← DEK-sensitive             │
│  customerAgreementSensitive ← DEK-sensitive           │
│  fraudDiagnosisCase       ← plaintext (no QE)           │
└─────────────────────────────────────────────────────────┘
```

**Two DEKs by design:**
- `DEK-lookup`: shared by equality-searchable collections. Rotation impacts all lookup collections simultaneously (acceptable for demo).
- `DEK-sensitive`: exclusive to sensitive/non-searchable collections. Level 2 investigator role requires access to this key only.

In production, each collection should have a dedicated DEK. The two-key model is a simplification for demo clarity.

### 7.3 KMS Configuration (Node.js / TypeScript)

```typescript
const kmsProviders = {
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,  // for temporary credentials
  }
};

const keyVaultNamespace = 'encryption.__keyVault';

const cmkOptions = {
  masterKey: {
    key: process.env.AWS_CMK_ARN!,   // arn:aws:kms:...
    region: process.env.AWS_REGION!,
  }
};
```

**Local KMS fallback for development (docker-compose only):**

```typescript
// backend/src/encryption/kms.ts
const kmsProviders = process.env.KMS_PROVIDER === 'local'
  ? { local: { key: Buffer.from(process.env.LOCAL_MASTER_KEY_BASE64!, 'base64') } }
  : { aws: { accessKeyId: ..., secretAccessKey: ... } };
```

---

## 8. Technical Architecture

### 8.1 Stack Summary

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Next.js 14 App Router + TypeScript | IST standard, SSR, Leafy Bank-compatible |
| **Backend API** | Fastify 4 + TypeScript | TypeScript-native, schema-first, performance |
| **Database** | MongoDB Atlas (M10+) | QE requires Atlas or Enterprise Advanced |
| **Encryption** | MongoDB QE auto-encryption + `crypt_shared` | No `mongocryptd` daemon needed with auto mode |
| **Key Management** | AWS KMS | Customer-controlled CMK, production-realistic |
| **Project setup** | npm workspaces + concurrently | Simple cross-workspace commands, no extra build tools |
| **Containerization** | Docker + Docker Compose | One-command environment |
| **UI Design** | LeafyGreen Design System | MongoDB IST standard |

### 8.2 Repository Structure

Follows the [IST Engineering Standards](../references/engineering-standards.md): frontend and backend are fully separated, each in its own named folder. The backend owns all database access, encryption logic, and business rules. The frontend is headless: it only calls the API.

```
sec-fsi-pci-dss/
├── frontend/                       # Next.js 14 App Router + TypeScript
│   ├── src/
│   │   ├── app/
│   │   │   ├── simulator/          # Story-driven: no login, presenter-controlled
│   │   │   │   ├── payment/        # 3-step checkout with encryption explainer
│   │   │   │   ├── investigation/  # Analyst dashboard + case detail + Atlas toggle
│   │   │   │   └── audit/          # Audit trail viewer (v2)
│   │   │   ├── demo/               # Application mode: JWT auth required
│   │   │   │   ├── payment/        # Customer checkout + transaction history
│   │   │   │   ├── investigation/  # L1 dashboard + case detail + escalation queue
│   │   │   │   └── audit/          # Security auditor read-only view
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx            # Mode selector landing
│   │   ├── components/             # LeafyGreen-based UI components
│   │   └── lib/
│   │       └── api-client.ts       # HTTP client: only API calls, no DB access
│   ├── public/
│   └── package.json
│
├── backend/                        # Fastify 4 + TypeScript
│   ├── bin/                        # Thin wrappers: entry points for setup and seed
│   │   ├── setup.ts                # Calls src/vendors/setup/
│   │   └── seed.ts                 # Calls src/vendors/seed/
│   ├── cfg/                        # Non-secret runtime configuration
│   ├── src/
│   │   ├── controllers/            # Route handlers: thin, delegate to services
│   │   │   ├── auth.controller.ts
│   │   │   ├── cardTransaction.controller.ts
│   │   │   ├── customerAgreement.controller.ts
│   │   │   ├── paymentCard.controller.ts
│   │   │   └── fraudDiagnosis.controller.ts
│   │   ├── services/               # Business logic and domain operations
│   │   │   ├── auth.service.ts
│   │   │   ├── cardTransaction.service.ts
│   │   │   ├── customerAgreement.service.ts
│   │   │   └── fraudDiagnosis.service.ts
│   │   ├── models/                 # BIAN interfaces + QE encryptedFieldsMaps
│   │   │   ├── partyAuthentication.model.ts
│   │   │   ├── cardTransaction.model.ts
│   │   │   ├── customerAgreement.model.ts
│   │   │   ├── paymentCard.model.ts
│   │   │   └── fraudDiagnosis.model.ts
│   │   ├── vendors/                # Infrastructure: encryption, setup, seed logic
│   │   │   ├── encryption/         # QE client, KMS, key vault, raw client
│   │   │   │   ├── qeClient.ts     # MongoClient with autoEncryption
│   │   │   │   ├── rawClient.ts    # Plain MongoClient (ciphertext view)
│   │   │   │   ├── kms.ts
│   │   │   │   ├── keyVault.ts
│   │   │   │   └── encryptedFieldsMaps.ts
│   │   │   ├── setup/              # Collection creation and index provisioning
│   │   │   └── seed/               # Seeding logic (one file per collection)
│   │   ├── middleware/             # JWT auth + RBAC enforcement
│   │   │   ├── auth.ts
│   │   │   └── rbac.ts
│   │   ├── plugins/                # Fastify plugins (mongodb, cors)
│   │   └── server.ts
│   ├── data/                       # JSON seed files: one per collection
│   │   ├── users.json              # 5 demo users (hashed passwords, roles)
│   │   ├── customerAgreements.json
│   │   ├── customerAgreementsSensitive.json
│   │   ├── paymentCards.json
│   │   ├── cardTransactions.json
│   │   ├── cardTransactionsSensitive.json
│   │   └── fraudCases.json
│   └── package.json                # Owns setup:db and seed scripts
│
├── docs/                           # Engineering documentation
│   ├── PRD.md                      # This document: what and why
│   ├── roadmap.md                  # FR + NFR per iteration
│   ├── technical-spec.md           # BIAN schemas, QE maps, API contracts
│   ├── engineering-proposal.md     # How to build it: architecture decisions
│   └── q&a.md                      # FSI client Q&A: PCI DSS + MongoDB
│
├── docker-compose.yml              # Full stack: frontend + backend → Atlas
├── .env.example                    # All required env vars with descriptions
├── package.json                    # Root command hub
└── tsconfig.base.json              # Shared TypeScript config
```

> Full technical detail: BIAN TypeScript interfaces, QE `encryptedFieldsMaps`, API contracts, and index creation scripts: is in [docs/technical-spec.md](technical-spec.md).

### 8.3 Root `package.json`: Command Hub

All commands are accessible from the repository root. No need to navigate into subdirectories.

```json
{
  "name": "fsi-pci-dss-demo",
  "private": true,
  "scripts": {
    "setup":            "npm install && npm install --prefix frontend && npm install --prefix backend",
    "dev":              "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:frontend":     "npm run dev --prefix frontend",
    "dev:backend":      "npm run dev --prefix backend",
    "build":            "npm run build --prefix frontend && npm run build --prefix backend",

    "setup:db":         "npm run setup:db --prefix backend",
    "setup:seed":       "npm run seed --prefix backend",

    "test":             "npm run test:unit && npm run test:integration",
    "test:unit":        "vitest run test/backend/unit test/frontend/unit",
    "test:integration": "vitest run test/backend/integration test/frontend/integration",
    "test:e2e":         "playwright test",
    "test:e2e:ui":      "playwright test --ui",
    "test:e2e:debug":   "playwright test --debug",
    "test:watch":       "vitest watch",
    "type-check":       "tsc --noEmit --project tsconfig.base.json"
  }
}
```

### 8.4 Environment Variables

```bash
# .env.example

# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=pci_dss_demo

# AWS KMS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
AWS_REGION=us-east-1
AWS_CMK_ARN=arn:aws:kms:us-east-1:<account>:key/<key-id>

# Local KMS (docker-compose development only: overrides AWS when set)
KMS_PROVIDER=aws               # 'aws' | 'local'
LOCAL_MASTER_KEY_BASE64=       # 96-byte key, base64 encoded

# API
API_PORT=3001
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:3000

# Authentication (Application Mode)
JWT_SECRET=                        # HS256 signing secret (min 32 chars)
JWT_EXPIRES_IN=24h
AUTH_DOMAIN=local                  # 'local' | 'msentra' (msentra: v2)

# Next.js
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 8.5 Docker Compose

**`docker-compose.yml`**: one command starts the full stack, connects to MongoDB Atlas:

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: .env
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      backend:
        condition: service_healthy
    environment:
      NEXT_PUBLIC_API_URL: http://backend:3001

# MongoDB is NOT included: IST demos use Atlas, not a local instance.
# Uncomment only for fully offline scenarios:
#  mongodb:
#    image: mongo:8
#    ports:
#      - "27017:27017"
```

---

## 9. Product Roadmap

### Iteration Overview

```
v1: Security Foundation    (2-3 weeks)
  Core payment simulation + QE encryption visible + basic investigation
  Goal: "something real you can show": the encryption story works end-to-end

v2: Investigation & Control  (4-6 weeks after v1)
  Multi-role RBAC, escalation workflow, audit trail, KMS key rotation
  Goal: answer the CISO's hardest questions: access control and auditability

v3: Agentic Fraud Investigation  (TBD: after v2 validated)
  AI pre-review on fraud trigger: MongoDB Agentic Platform (Magenta preferred)
  Goal: AI-assisted L1 draft + human confirmation loop on investigation workflow

v4: Advanced Capabilities  (TBD: after v3 validated)
  Range queries, tokenization for recurring payments, performance visualization
  Goal: Leafy Bank integration-ready, Solutions Library publishable

v5: Payment Gateway + Modular Architecture  (TBD: after v4 validated)
  Backend refactored to domain modules (BIAN SD clusters) + new gateway module
  New BIAN SDs: SD-89 Merchant Relations · SD-64 Payment Order · SD-65 Payment Execution · SD-57 Card Etoken
  New collections: merchantAgreement · paymentOrder · tokenVault
  New actors: Merchant (first-class entity with MCC risk profile, limits, settlement config)
  Goal: API-first payment platform story — MongoDB as the data backbone for a full card payment gateway
```

### v1: Security Foundation

**Theme:** Show that QE works. A user submits a payment, fields are encrypted on the client, and a fraud analyst finds the record by searching an encrypted field.

**Deliverables:**
- Runnable monorepo (`npm run setup` + `npm run dev`)
- Payment simulation screen with 3-step checkout
- Fraud investigation dashboard with encrypted-field search
- Visual encryption explainer: "before/after" document view
- Synthetic seed data: 50 customers, 200 transactions, 20 fraud cases
- AWS KMS integration (local KMS fallback for offline demos)
- README with setup instructions

**Out of scope for v1:** RBAC, escalation, audit viewer, range queries, card save/tokenization

### v2: Investigation & Control

**Theme:** Show that access control and auditability are built into the architecture.

**Deliverables:**
- Multi-role login simulation (Level 1 Analyst, Level 2 Investigator, Security Auditor)
- Escalation workflow: request + approve + reveal sensitive fields (FR-v2-11)
- Audit trail UI: event timeline per case and global audit log for Security Auditor (FR-v2-12, FR-v2-14)
- HRPC risk check integration: validate a customer against High-Risk Person and Counterparty categories (PEP, SIP, HNWI, fraud history, sanctions, high-risk jurisdictions) via `GET /api/v1/fraud/hrpc/check`
- Role-aware case detail views with debug mode for technical context during demos
- RBAC API layer enforcing least-privilege data access at DEK level (FR-v2-13)
- KMS key rotation demo flow
- Range queries on `transactionAmount.amount` (QE range) (FR-v2-15)
- Data model documentation (`docs/data-model.md` with ERD)

**v2 implementation status (2026-06-05):**
- FR-v2-11 (Escalation Workflow): `POST /fraud/:id/escalate/approve` implemented. Generates escalation token, appends audit event, returns token to L2 Investigator.
- FR-v2-13 (RBAC API Layer): RBAC middleware implemented. Role extracted from JWT or `X-Demo-Role` header. L1 blocked from sensitive collections. L2 requires valid escalation token.
- FR-v2-14 (Audit Log API): `GET /api/v1/fraud/audit-events` implemented. Security Auditor can view all events across all cases.
- HRPC Service: `GET /api/v1/fraud/hrpc/check` implemented. Demo dataset with PEP, HNWI, suspicious patterns, and fraud history profiles.
- App Mode L1/L2/Auditor views: Realistic role-based UX aligned to FDS operating model. Debug mode toggle for technical context.
- Simulator Mode STEP1/STEP3: Improved with multi-collection Atlas storage map and FDS-aligned L2 investigation sources.

### v3: Agentic Fraud Investigation

**Theme:** AI-assisted investigation using MongoDB Agentic Platform (Magenta preferred).

**Deliverables:**
- AI pre-review triggered automatically when a fraud diagnosis case opens
- Agent queries QE collections (email, card token, account ref) and evaluates fraud indicators
- Agent produces a structured draft diagnosis: risk summary, recommended action, confidence score
- L1 analyst sees the AI draft inline in the case detail; confirms, overrides, or escalates
- L2 investigator sees AI context alongside sensitive field reveal
- All agent actions logged in `diagnosisActionLog` with `performedByRole: 'ai_agent'`

### v4: Advanced Capabilities

**Theme:** Production-realism and integration readiness.

**Deliverables:**
- Save card for recurring payment (tokenization flow: addresses expert's browser cache scenario)
- Performance visualization: query time with QE vs plaintext index
- QE substring/prefix queries (if GA by then: MongoDB 8.2+)
- Leafy Bank integration scaffold (shared auth, shared API contracts)
- Solutions Library article draft
- Slide deck (ks-mongodb-writer-deck standard)

### v5: Payment Gateway + Modular Architecture

**Theme:** MongoDB as the data backbone of a full card payment gateway, structured around BIAN Service Domains.

**Deliverables:**
- Backend refactored to domain module layout: `src/modules/<sd-cluster>/` + `src/shared/` — zero API surface change, all existing tests pass
- Four new BIAN Service Domains: SD-89 Merchant Relations, SD-64 Payment Order, SD-65 Payment Execution, SD-57 Card Etoken
- Three new collections: `merchantAgreement` (QE:none on API key hash), `paymentOrder` (intent lifecycle with TTL index), `tokenVault` (QE:none on network token)
- Merchant as first-class actor: MCC risk category, transaction limits, settlement schedule, webhook endpoint
- Gateway API: `POST /gateway/payments` (create intent with idempotency key) → confirm → authorize → capture → void/refund
- Payment Order lifecycle: `initiated → confirmed → authorized → captured → settled/refunded/voided`
- Merchant context in fraud investigation: investigator sees merchant's average transaction amount, volume, risk category alongside the case
- Simulator Mode: new step 0 showing merchant creating the payment intent before customer checkout
- `shared/services/fraudTrigger.service.ts`: shared fraud evaluation extracted so both `transactions` and `gateway` modules trigger fraud cases through the same path

---

## 10. Feature Requirements

> The complete FR and NFR breakdown per iteration: with acceptance criteria and Definition of Done: is in **[docs/roadmap.md](roadmap.md)**.

The following is a high-level summary. Refer to the roadmap for the full specification.

### Summary by Iteration

| Version | Key Frontend Features | Key Backend Features |
|---|---|---|
| **v1** | Mode selector landing, simulator flow (payment + investigation + Atlas toggle), application mode (login + role-based routing) | JWT auth, QE writes, equality search, auto-fraud-case creation, `/health` endpoint |
| **v2** | Role selector (Level 1 / Level 2 / Auditor), escalation workflow, audit trail timeline | RBAC middleware, escalation endpoint, audit log queries, range queries on amount |
| **v3** | AI draft inline in case detail, agent confidence indicator, agent action log | Magenta agent integration, structured draft diagnosis output |
| **v4** | Save card / recurring payment flow, performance comparison panel | Tokenization endpoint, query-timing diagnostic endpoint, Leafy Bank API contracts |
| **v5** | Simulator step 0 (merchant creates payment intent), merchant profile panel in fraud case detail, merchant portal in Application Mode | Backend modular refactor (BIAN SD modules), gateway API (`/gateway/payments`, `/merchants`, `/gateway/tokens`), 3 new collections (merchantAgreement · paymentOrder · tokenVault), merchant seed data |

See [docs/roadmap.md](roadmap.md) for the complete FR and NFR specification with acceptance criteria per iteration.

---

## 11. PCI DSS Alignment

The demo is positioned as a **PCI DSS-aligned reference architecture**, not a compliance certification. MongoDB Atlas holds PCI DSS 4.0 certification (September 2023). The customer remains responsible for their own PCI DSS program.

| PCI DSS v4.0 Requirement | How the Demo Addresses It | MongoDB Feature |
|---|---|---|
| **Req 3: Protect stored account data** | Cardholder data encrypted before storage; SAD never stored | Queryable Encryption |
| **Req 3.5: Protect primary account numbers** | Full PAN never stored; only tokenized reference and masked display value | Data minimization by design |
| **Req 3.6: Cryptographic key management** | AWS KMS CMK; separate DEKs for lookup vs sensitive; key rotation demonstrated (v2) | QE + AWS KMS |
| **Req 4: Protect data in transit** | TLS 1.3 default on all Atlas connections | Atlas TLS by default |
| **Req 7: Restrict access by business need** | Role-based field projection; Level 1 cannot see sensitive collections | RBAC + API-layer projection (v2) |
| **Req 8: Identify and authenticate users** | Atlas RBAC, database users scoped per service role | Atlas Database Users |
| **Req 10: Log and monitor access** | Audit log for every field access event in investigation workflow | Atlas Audit Log (v2) |

**Key message for the demo:**
> MongoDB Atlas reduces PCI scope by ensuring that server-side infrastructure: Atlas nodes, cloud provider infrastructure, MongoDB support: never handles plaintext cardholder data. The encryption boundary is the application client.

**What the demo does NOT address (out of scope):**
- Requirement 5 (anti-malware), 6 (secure software dev), 9 (physical access), 11 (penetration testing), 12 (policies): these are operational/organizational requirements outside the data platform layer.

---

## 12. Q&A Coverage Matrix

The demo directly addresses the following questions from `docs/q&a.md`:

| Q&A ID | Question | Demo Coverage | Feature |
|---|---|---|---|
| Q1 | What is PCI DSS? | Covered in UI explainer panel | Onboarding screen |
| Q2 | Is MongoDB Atlas PCI DSS certified? | Yes: PCI DSS 4.0 (Sept 2023). Shown in demo trust panel | Static content |
| Q3 | Can I store cardholder data on MongoDB Cloud? | Yes, demonstrated live | QE storage flow |
| Q4 | Will I be automatically compliant? | No: shared responsibility model explained in UI | Explainer card |
| Q5 | Where to download AOC? | Link to Trust Portal in UI | Static link |
| Q6 | Which security features help PCI compliance? | QE, TLS, Private Endpoint (diagram), federated identity, audit log | All features |
| Q7 | Who is the QSA? | Schellman Compliance LLC: shown in trust panel | Static content |
| Q8 | Which services are in PCI scope? | Atlas, App Services, Charts, Serverless, Cloud Manager, Data Federation, Search | Static content |

---

## 13. Installation & DevOps

### Quick Start (3 commands)

```bash
# 1. Clone and configure environment
git clone <repo-url> && cd sec-fsi-pci-dss
cp .env.example .env      # fill in MONGODB_URI + AWS KMS credentials (or set KMS_PROVIDER=local)

# 2. Install all dependencies
npm run setup

# 3a. Set up the database and seed demo data
npm run setup:db && npm run setup:seed

# 3b. Start the full stack (hot reload)
npm run dev
```

### Individual Commands

| Command | Description |
|---|---|
| `npm run setup` | Install root + frontend + backend dependencies |
| `npm run dev` | Start frontend and backend concurrently (hot reload) |
| `npm run dev:frontend` | Start only the Next.js frontend (:3000) |
| `npm run dev:backend` | Start only the Fastify API (:3001) |
| `npm run build` | Build frontend and backend for production |
| `npm run setup:db` | Create QE collections, provision DEKs and indexes |
| `npm run setup:seed` | Insert synthetic BIAN-compliant demo data (idempotent) |
| `npm run test` | Run unit + integration tests (Vitest) |
| `npm run test:unit` | Unit tests only (no Atlas required) |
| `npm run test:integration` | Integration tests (requires `TEST_MONGODB_URI`) |
| `npm run test:e2e` | Playwright end-to-end browser tests |
| `npm run test:e2e:ui` | Playwright interactive UI mode |
| `npm run test:watch` | Vitest watch mode (development) |
| `npm run type-check` | TypeScript type check without emitting |

### `backend/bin/setup.ts` Responsibilities

`backend/bin/setup.ts` is a thin wrapper. All logic lives in `backend/src/vendors/setup/`:

1. Validate environment variables (fail fast with helpful error if missing)
2. Connect to MongoDB Atlas (plain client for DEK provisioning)
3. Provision KMS provider (AWS or local based on `KMS_PROVIDER`)
4. Create or retrieve `DEK-lookup` and `DEK-sensitive` in `encryption.__keyVault`
5. Create all 7 collections using `createEncryptedCollection()` with QE schemas
6. Create all indexes per the index strategy in §6.5
7. Apply JSON Schema validation on `fraudDiagnosisCase` (plaintext collection)
8. Print setup summary: collections created, DEKs provisioned, indexes applied

### `backend/bin/seed.ts` Responsibilities

`backend/bin/seed.ts` is a thin wrapper. All logic lives in `backend/src/vendors/seed/`:

1. Upsert demo users into `partyAuthentication` (hashed passwords, roles)
2. Upsert synthetic BIAN-compliant data (no real PII: Faker.js)
3. Insert in dependency order: users → customers → cards → transactions → fraud cases
4. Respect QE encryption: use the QE-enabled client for all writes to QE collections
5. Idempotent: safe to re-run without creating duplicates (upsert by primary key)
6. Print seed summary: documents upserted per collection

---

## 14. Success Metrics

### Demo Quality Criteria

| Criterion | Measure |
|---|---|
| **Setup time** | `npm run setup` + `setup:db` + `setup:seed` + `dev` completes in < 5 minutes |
| **Demo flow** | CISO persona walkthrough completes in ≤ 10 minutes |
| **Explainability** | Non-technical AE can run the demo without engineering support after 1 practice session |
| **Offline capability** | Demo runs fully offline with `KMS_PROVIDER=local` for travel/conference scenarios |
| **Type safety** | Zero TypeScript errors at build time |
| **BIAN fidelity** | All 6 collections use BIAN Service Domain naming; mapping documented |

### PCI DSS Narrative Metrics

| Message | Demo Moment |
|---|---|
| "Server never sees plaintext" | Raw document view in Atlas Data Explorer shows ciphertext |
| "Keys are yours" | AWS KMS CMK shown; MongoDB has no access |
| "Search without decryption" | QE equality query on email/phone returns result |
| "Least privilege works" | Level 1 search returns masked result; Level 2 reveals sensitive fields |

---

## 15. Open Questions & Decisions Log

| # | Question | Decision | Date |
|---|---|---|---|
| 1 | Use CSFLE or QE only? | QE only: simplifies the architecture and the explainability narrative | 2026-05-26 |
| 2 | Standalone or Leafy Bank? | Standalone v1, designed for future Leafy Bank integration | 2026-05-26 |
| 3 | KMS provider | AWS KMS (local KMS fallback for offline demos) | 2026-05-26 |
| 4 | Backend framework | Fastify (TypeScript-native, schema-first) | 2026-05-26 |
| 5 | BIAN naming depth | Full BIAN naming: Service Domain, Control Record, field vocabulary | 2026-05-26 |
| 6 | Demo entry point v1 | Payment simulation flow (card checkout → alert → investigation) | 2026-05-26 |
| 7 | Store full PAN? | Never. Tokenized reference (`paymentCardReference`) only | 2026-05-26 |
| 8 | `$lookup` across QE collections? | Not supported. Application-side joins only | 2026-05-26 |
| 9 | Project setup tool | npm workspaces + concurrently (no Turborepo) | 2026-05-26 |
| 10 | customerName encryption | Plaintext in v1 for display simplicity; QE:equality in v2 | 2026-05-26 |
| 11 | Single-mode or dual-mode demo? | Dual-mode: Simulator (no login) + Application (JWT login, roles) | 2026-05-27 |
| 12 | Perspective switch after payment | Auto-switch after confirmation (3s countdown) + manual "Stay here" button | 2026-05-27 |
| 13 | Split-screen vs full-page | Full-page default + optional split-screen toggle for technical audiences | 2026-05-27 |
| 14 | Raw Atlas document toggle | Real ciphertext fetched from Atlas via plain MongoClient endpoint | 2026-05-27 |
| 15 | Authentication model | Local JWT (HS256) stored in `partyAuthentication`; extensible to MS Entra ID | 2026-05-27 |
| 16 | Seeder user selection UX | Username dropdown auto-fills password on selection; dev-friendly | 2026-05-27 |
| 17 | Bin/ vs backend/vendors/ | Setup/seed logic lives in `backend/src/vendors/`; `bin/` are thin wrappers | 2026-05-27 |
| 18 | v3 scope | Agentic fraud investigation (Magenta AI agent); old v3 becomes v4 | 2026-05-27 |

---

*This document is a living artifact. Update the Decisions Log with any architectural or scope change agreed during development.*
