# PRD: FSI PCI DSS Payment Security Demo

| Field | Value |
|---|---|
| **Version** | 1.1 |
| **Status** | Active |
| **Author** | Antonio Membrides Espinosa |
| **Date** | 2026-06-10 |
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
| TTL Indexes | Auto-expire checkout sessions (30 min) and optional payment link expiry |

### Payment Integration Use Case (Ch-04)

**Problem:** External merchants want to accept card payments through the LeafyBank Payment Gateway without handling cardholder data themselves, the standard "easy integration" requirement that every payment provider answers with a hosted payment page.

**Solution: two integration patterns, lowest PCI scope:**

#### Redirect Checkout

An external merchant's backend creates a checkout session via API. The buyer is redirected to a hosted payment page on the PSP domain where card entry happens. After payment the buyer is redirected back to the merchant.

**PCI DSS scope for external merchant:** SAQ A, the merchant's system never sees cardholder data at any point.

```
Merchant System        LeafyBank Gateway                    Buyer Browser
    │                         │                                     │
    ├── POST /checkout/sessions ──►                                 │
    │◄── { paymentPageUrl } ──────                                  │
    │                                                               │
    ├── redirect buyer ──────────────────────────────────────────► │
    │                         │◄── load /checkout/{sessionId} ─── │
    │                         ├── show card form ───────────────► │
    │                         │◄── submit card token ─────────── │
    │                         ├── create cardTransactionLog ───►  │
    │◄── webhook event ───────│                                    │
    │                         ├── redirect to returnUrl ────────► │
    │◄── GET /checkout/sessions/{id} (verify)                      │
```

#### Payment Links

A merchant creates a shareable URL ahead of time. No buyer session is required on the merchant side. The URL can be emailed, printed as a QR code, or embedded in a social media post.

```
Merchant System        LeafyBank Gateway
    │                         │
    ├── POST /payment-links ──►
    │◄── { paymentUrl } ──────
    │
    │  (merchant shares paymentUrl anywhere)
    │
                        │◄── buyer opens /pay/{code}
                        ├── show card form
                        │◄── submit card token
                        ├── create cardTransactionLog
                        ├── show success screen
                        ├── webhook event ──► merchant (optional)
```

**Key BIAN insight:** Both patterns store their session/link state in MongoDB using SD-64 (Payment Order) collections. The card transaction created on payment is the same `cardTransactionLog` (SD-254) document that feeds into the fraud investigation workflow. The PCI DSS boundary is the PSP's hosted pages, not the merchant's system.

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
| **Merchant** *(Ch-04)* | Write: checkout sessions, payment links; Read: own merchant data | Create checkout sessions, create payment links, manage API keys, view webhook logs |
| **Merchant Officer** *(Ch-05)* | Write: merchant agreement Control actions; Read: all merchant applications | Review pending merchant onboarding applications; approve or reject with KYB notes (BIAN SD-89, Action: Control) |
| **Operations Officer** *(v29)* | Write/Read: global card inventory (SD-88) and payout accounts (SD-66) via the built-in modules, plus configuration/policies of all internal modules (`modules:[view,manage]`); Read: audit events and provider status (`providers:[view]`) | Owns internal business logic and financial processes: administer the whole card and payout-account book (list, register, edit, activate/suspend, revoke cards; register, edit, close accounts) and the config/policies of the internal engines (fds, aml, hrp, kyc, kyb, credit-bureau, card-authorization, card-issuer, account-information, payment-initiation, vop). Its landing shows, read-only, which provider serves each capability (internal vs external). Back-office counterpart to self-service, gated to the internal provider. Separation of duties: no provider CRUD, no auth domains or roles (those stay with `manager`), nor fraud/transaction data |

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

        ↓

[6. Merchant Onboarding (Ch-05)]
   A customer submits a merchant application via the Merchant portal.
   Status becomes 'under_review': the document is in the merchantAgreementProcedure collection.
   A Merchant Acquiring officer (merchant_officer role) reviews the application
   and performs a KYB (Know Your Business) check before approving.
   On approval: status transitions to 'agreed', then 'active' upon T&C acceptance.
   The same Party (SD-13) record that holds the CustomerAgreement (SD-53)
   now also owns the MerchantAgreement (SD-89): the BIAN dual-role pattern.
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

#### v1–v3: Core demo SDs (currently implemented)

| # | BIAN Service Domain | SD Reference | Role in Demo | Collection | Version |
|---|---|---|---|---|---|
| 1 | **Party Data Management** | SD-13 | Canonical PII store: email, phone, name | `party` | v1 |
| 2 | **Customer Authentication** | SD-91 | Login credentials, roles, access state | `customerAuthenticationAssessment` | v1 |
| 3 | **Party Authentication** | SD-16 | Identity verification events; auth domain config | `partyAuthenticationAssessment` | v1 |
| 4 | **Card Transaction** | SD-254 | Records card payment events; QE:none fields (gateway payload, processor metadata) stored inline | `cardTransactionLog` | v1 |
| 5 | **Customer Agreement** | SD-53 | Customer account (no PII; links to `party`); QE:none fields (address, govId, riskNotes) stored inline | `customerAgreementProcedure` | v1 |
| 8 | **Payment Card** | SD-88 | Stored card instruments (tokens) | `paymentCardManagement` | v1 |
| 9 | **Fraud Diagnosis** | SD-83 | Investigation cases and workflow | `fraudDiagnosisCase` | v1 |
| 10 | **Customer Credit Rating** | SD-60 | HRPC risk profiles | `customerCreditRatingState` | v1 |
| 11 | **Consent Agreement** *(stub)* | SD-36 | Open Banking consent grants | `consentAgreement` | v3 stub |
| 12 | **Consent Access Log** *(stub)* | SD-36 | Open Banking API access audit trail | `consentAccessLog` | v3 stub |

#### v4: Payment Gateway SDs (Ch-04 - Redirect Checkout + Payment Links)

| # | BIAN Service Domain | SD Reference | Role in Demo | Collection | Version |
|---|---|---|---|---|---|
| 8 | **Merchant Relations** | SD-89 | Merchant profile, MCC, limits, API key management | `merchantAgreementProcedure` | v4 |
| 9 | **Payment Order** (Checkout Session) | SD-64 | Redirect Checkout: hosted payment page session lifecycle | `checkoutSessionLog` | v4 |
| 10 | **Payment Order** (Payment Link) | SD-64 | Payment Links: shareable pre-configured payment URL | `paymentLinkRecord` | v4 |
| 11 | **Payment Execution** | SD-65 | Gateway routing and authorization orchestration | *(service layer, no dedicated collection)* | v4 |
| 12 | **Card eToken** | SD-57 | Token vault: card token references and network tokens | `cardEtokenProcedure` | v4 stub |

#### v17: Bank-movement precision SDs (Funds-Availability Gate + FX)

| # | BIAN Service Domain | SD Reference | Role in Demo | Collection | Version |
|---|---|---|---|---|---|
| 13 | **Account Information (AIS)** | SD-36 | Funds-availability gate: reads funding-account balance (built-in reads internal ledger; PSD2 AIS substitutable) and drives the atomic hold | `payoutAccountArrangement` (read) | v17 |
| 14 | **Currency Exchange** |: (adjunct SD-66) | Converts amounts into the account currency before any balance mutation (mid rate + spread); replaceable by an external FX provider | *(built-in module, config in `capabilityModuleConfiguration`)* | v17 |

> **Note 5 (v17):** Card-payment authorization adds a 4th parallel gate `funds` (SD-36) to the issuer/FDS/HRP gates. The hold is atomic (`$gte`-conditional `$inc`) and is the authoritative decision; it is released as a saga compensation if any gate declines. Insufficient funds → `declined` + ISO-8583 `'51'`. See [engineering-proposal.md ADR-038](engineering-proposal.md).

> **Note 1:** BIAN does not define separate "sensitive" collections; the split is an architectural pattern for separating searchable QE fields from non-searchable QE fields, as required by MongoDB QE design constraints.
>
> **Note 2:** `customerAuthenticationAssessment` (SD-91) stores pre-seeded user accounts (email as QE:equality, bcrypt password hash, role) to support Application Mode login. Identity verification events belong to `partyAuthenticationAssessment` (SD-16). In a production FSI system, authentication would be delegated to an identity provider (e.g., MS Entra ID). The SD-91 collection demonstrates that even user credential lookups can be encrypted via QE.
> 
> **Note 4:** SD-13 `party` is the canonical PII store. `customerAgreementProcedure` (SD-53) holds only business keys and a `partyInstanceReference` FK, no email or phone. Email/phone lookups require a two-step query: (1) QE equality on `party.partyEmailAddress` → get `partyInstanceReference`; (2) plaintext index lookup on `customerAgreementProcedure.partyInstanceReference`. See `tmp/wiki/bian-openbanking-tradeoffs.md §1` for the performance analysis.
>
> **Note 3 (v4):** The backend module structure mirrors the BIAN SD grouping. Each module owns the collections, services, and API routes for its assigned SDs. See [engineering-proposal.md §3.8](engineering-proposal.md) for the full BIAN Module Map.

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
  cardTransactionAmount: {
    amount: number;                               // QE:range in v2
    currency: string;                             // ISO 4217
  };
  cardTransactionDateTime: Date;
  cardTransactionStatus: 'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
  cardTransactionType: 'purchase' | 'cash_advance' | 'balance_transfer' | 'refund' | 'fee' | 'adjustment';
  cardTransactionChannel: 'online' | 'pos' | 'contactless' | 'atm';
  cardTransactionMerchantCategoryCode: string;    // MCC code (plaintext)
  cardTransactionMerchantName: string;            // plaintext
  cardTransactionMaskedPanDisplay: string;        // plaintext: display only: ****-****-****-1234

  // BIAN SD-254 statement descriptor fields (plaintext, not CHD, no QE required)
  cardTransactionDescription: string;             // max 22 chars; appears on cardholder bank statement
  cardTransactionNarrative?: string;              // extended context for L1/L2 fraud investigation

  // BIAN metadata
  bianServiceDomain: 'Card Transaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;                          // current: 3
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

> **v2 note:** Sensitive QE:none fields (`rawGatewayPayload`, `processorTransactionMetadata`, `customerAgreementResidentialAddress`, `governmentIdentificationReference`, `customerAgreementRiskNotes`) are stored **inline** in their parent collections (`cardTransactionLog` and `customerAgreementProcedure`). The Level 1 QE client's `encryptedFieldsMap` omits them, returning Binary ciphertext that the API strips from Level 1 responses. The Level 2 QE client includes all fields and auto-decrypts them upon escalation token validation.

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
  cardExpirationDate: string;                    // QE:none: MM/YY format, CHD co-located with card reference

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
  escalationAcceptedAt?: Date;                   // set when L2 approves; persisted so approval survives refresh
  caseResolutionOutcome?: 'fraud_confirmed' | 'false_positive' | 'chargeback_initiated' | 'under_review';

  // DEPRECATED fields: do not write; use the notes event endpoints instead
  // (Ch-03, 2026-06-10: replaced by fraudDiagnosisCaseEvents append-only log)
  /** @deprecated Use POST/DELETE/GET /api/v1/fraud/:id/notes instead */
  fraudDiagnosisCaseNotes?: string;
  /** @deprecated Customer-visible notes are now visibility:'customer' events in fraudDiagnosisCaseEvents */
  fraudDiagnosisCustomerSubjectNotes?: string;

  // Case notes: append-only event log (Ch-03)
  // Notes are stored as immutable `note_added` events. Errors are corrected via a `note_retracted`
  // event (BIAN SD-83 append-only principle, PCI DSS Req 10.3).
  // The customer sees a chronological list of visibility:'customer' notes in their transaction detail view.
  // Managed via: POST /api/v1/fraud/:id/notes · DELETE /api/v1/fraud/:id/notes/:noteId
  //              GET  /api/v1/fraud/:id/notes
  fraudDiagnosisCaseEvents: Array<{
    eventId: string;                             // UUID
    eventDateTime: Date;
    eventType: 'note_added' | 'note_retracted';
    performedByRole: string;
    noteText?: string;                           // present on note_added; absent on note_retracted
    retractedEventId?: string;                   // present on note_retracted; references the note_added event
    visibility: 'internal' | 'customer';         // 'customer' notes appear in transaction detail view
  }>;

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
party (SD-13)                                   ← canonical PII owner
  │  partyInstanceReference (FK)
  │
  ├──► customerAuthenticationAssessment (SD-91)  ← login credentials, role
  │         (via partyInstanceReference)
  │
  └──► partyAuthenticationAssessment (SD-16)     ← identity verification events
            (via partyInstanceReference)

customerAgreementProcedure (SD-53)  [inline QE:none: address, govId, riskNotes]
  │  partyInstanceReference ───────────────────────────► party
  │
  │ 1 : many
  ↓
paymentCardManagement (SD-88)
  │ (via paymentCardReference token)
  │ many : 1
  ↓
cardTransactionLog (SD-254)  [inline QE:none: rawGatewayPayload, processorMetadata]
  │
  │ 1 : many
  ↓
fraudDiagnosisCase (SD-83) ─── links to ──► cardTransactionLog
  (cardTransactionInstanceReference + customerAgreementInstanceReference)

consentAgreement (SD-36) ──────────────────────────────► party
  │  partyInstanceReference                        (v3 Open Banking stub)
  │ 1 : many
  ↓
consentAccessLog (SD-36)

merchantAgreementProcedure (SD-89) ────────────────────► party
  │  merchantOwnerPartyReference          (D-21: BIAN-canonical Party owner link)
  │  Note: same Party can own a CustomerAgreement (SD-53) AND a MerchantAgreement (SD-89)
  │: dual-role pattern. Identity anchor is Party, not the role-scoped Agreement.
  │ 1 : many
  ↓
checkoutSessionLog (SD-64) / paymentLinkRecord (SD-64)
  cardTransactionLog (SD-254) ◄── created on each payment
```

**Join strategy:** Application-side joins only. No `$lookup` across QE collections (not supported for encrypted fields). The API service performs sequential queries and assembles the response.

### 6.5 Index Strategy

| Collection | Index | Type | Purpose |
|---|---|---|---|
| `party` | `partyInstanceReference` | Unique | Primary lookup; QE manages `partyEmailAddress` / `partyMobilePhoneNumber` |
| `customerAuthenticationAssessment` | `customerAuthenticationInstanceReference` | Unique | Primary lookup |
| `customerAuthenticationAssessment` | `partyInstanceReference` | Single field | Auth record by party |
| `customerAuthenticationAssessment` | `customerAuthenticationUserRole` | Single field | User list by role |
| `customerAgreementProcedure` | `customerAgreementInstanceReference` | Unique | Primary lookup |
| `customerAgreementProcedure` | `partyInstanceReference` | Single field | Two-step PII lookup join key |
| `customerAgreementProcedure` | `customerAgreementStatus` | Single field | Active customer filtering |
| `paymentCardManagement` | `paymentCardInstanceReference` | Unique | Primary lookup |
| `paymentCardManagement` | `paymentCardReference` | Single field | Token lookup (standard index: not QE) |
| `paymentCardManagement` | `customerAgreementInstanceReference` | Single field | Cards by customer |
| `cardTransactionLog` | `cardTransactionInstanceReference` | Unique | Primary lookup |
| `cardTransactionLog` | `paymentCardReference` | Single field | Transactions by token (standard index: not QE) |
| `cardTransactionLog` | `cardTransactionDateTime` | Single field | Time-range filtering |
| `cardTransactionLog` | `cardTransactionStatus` | Single field | Status filtering |
| `fraudDiagnosisCase` | `fraudDiagnosisInstanceReference` | Unique | Primary lookup |
| `fraudDiagnosisCase` | `cardTransactionInstanceReference` | Single field | Case by transaction |
| `fraudDiagnosisCase` | `customerAgreementInstanceReference` | Single field | Cases by customer |
| `fraudDiagnosisCase` | `fraudDiagnosisCaseStatus, fraudDiagnosisCaseSeverity` | Compound | Dashboard filtering |

> QE encrypted fields (`paymentCardReference`, `customerEmailAddress`, etc.) use QE metadata indexes automatically managed by the driver: do not create manual indexes on these fields.

---

## 7. Queryable Encryption Design

### 7.1 QE Field Classification Table

| Field | BIAN SD | PCI Classification | QE Mode | Collection | Demo Version |
|---|---|---|---|---|---|
| `partyEmailAddress` | Party Data Management (SD-13) | PII | `equality` | `party` | v1 |
| `partyMobilePhoneNumber` | Party Data Management (SD-13) | PII | `equality` | `party` | v1 |
| `customerAuthenticationEmailAddress` | Customer Authentication (SD-91) | PII | `equality` | `customerAuthenticationAssessment` | v1 |
| `customerAgreementReference` | Customer Agreement (SD-53) | CHD-adjacent | `equality` | `customerAgreementProcedure` | v1 |
| `paymentCardReference` (on card) | Payment Card (SD-88) | **Card surrogate: not CHD under PCI DSS v4.0** | **plaintext (indexed)** | `paymentCardManagement` | v1 |
| `paymentCardExpirationDate` | Payment Card (SD-88) | CHD | `none` | `paymentCardManagement` | v1 |
| `paymentCardReference` (on tx) | Card Transaction (SD-254) | **Card surrogate: not CHD under PCI DSS v4.0** | **plaintext (indexed)** | `cardTransactionLog` | v1 |
| `cardTransactionAccountReference` | Card Transaction (SD-254) | CHD-adjacent | `equality` | `cardTransactionLog` | v1 |
| `rawGatewayPayload` | Card Transaction (SD-254) | Internal | `none` | `cardTransactionLog` (inline) | v1 |
| `processorTransactionMetadata` | Card Transaction (SD-254) | Internal | `none` | `cardTransactionLog` (inline) | v1 |
| `customerAgreementResidentialAddress` | Customer Agreement (SD-53) | PII | `none` | `customerAgreementProcedure` (inline) | v1 |
| `governmentIdentificationReference` | Customer Agreement (SD-53) | PII | `none` | `customerAgreementProcedure` (inline) | v1 |
| `customerAgreementRiskNotes` | Customer Agreement (SD-53) | Internal | `none` | `customerAgreementProcedure` (inline) | v1 |
| `cardTransactionAmount.amount` | Card Transaction (SD-254) |: | `range` | `cardTransactionLog` | **v2** |
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
┌──────────────────────────▼────────────────────────────────────────────┐
│                 MongoDB Atlas Cluster                                 │
│                                                                       │
│  party                            ← DEK: partyEmail, partyPhone       │
│  customerAuthenticationAssessment ← DEK: authEmail                    │
│  customerAgreementProcedure ← DEK: customerAccountRef (equality)      │
│                               DEK: customerAddress, customerGovId,    │
│                                    customerRiskNotes (QE:none inline) │
│  cardTransactionLog         ← DEK: txAccountRef (equality)            │
│                               DEK: txRawPayload, txProcessorMeta      │
│                                 (QE:none inline)                      │
│  paymentCardManagement      ← DEK: cardExpiry                         │
│  fraudDiagnosisCase         ← plaintext (no QE)                       │
└───────────────────────────────────────────────────────────────────────┘
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
// psp/backend/src/encryption/kms.ts
const kmsProviders = process.env.KMS_PROVIDER === 'local'
  ? { local: { key: Buffer.from(process.env.KMS_LOCAL_MASTER_KEY!, 'base64') } }
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
├── psp/frontend/                   # Next.js 14 App Router + TypeScript
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
├── psp/backend/                    # Fastify 4 + TypeScript
│   ├── bin/                        # Thin wrappers: entry points for setup and seed
│   │   ├── setup.ts                # Calls src/vendors/setup/
│   │   └── seed.ts                 # Calls src/vendors/seed/
│   ├── cfg/                        # Non-secret runtime configuration
│   ├── src/
│   │   ├── controllers/            # Route handlers: thin, delegate to services
│   │   │   ├── auth.controller.ts
│   │   │   ├── transactions.controller.ts
│   │   │   ├── customer.controller.ts
│   │   │   ├── cards.controller.ts
│   │   │   └── fraudDiagnosis.controller.ts
│   │   ├── services/               # Business logic and domain operations
│   │   │   ├── auth.service.ts
│   │   │   ├── transactions.service.ts
│   │   │   ├── customer.service.ts
│   │   │   └── fraudDiagnosis.service.ts
│   │   ├── models/                 # BIAN interfaces + QE encryptedFieldsMaps
│   │   │   ├── party.model.ts                          # SD-13
│   │   │   ├── customerAuthentication.model.ts         # SD-91
│   │   │   ├── partyAuthentication.model.ts            # SD-16
│   │   │   ├── cardTransaction.model.ts                # SD-254
│   │   │   ├── customerAgreement.model.ts              # SD-53
│   │   │   ├── paymentCard.model.ts                    # SD-88
│   │   │   └── fraudDiagnosis.model.ts                 # SD-83
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
│   │   ├── parties.json            # 53 party records (SD-13)
│   │   ├── customerAuthentications.json  # 5 demo users (SD-91, hashed passwords, roles)
│   │   ├── customerAgreements.json       # (SD-53, QE:none fields inline)
│   │   ├── paymentCards.json             # (SD-88)
│   │   ├── cardTransactions.json         # (SD-254, QE:none fields inline)
│   │   └── fraudCases.json               # (SD-83)
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
    "setup":            "npm install && npm install --prefix psp/frontend && npm install --prefix psp/backend",
    "dev":              "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:frontend":     "npm run dev --prefix psp/frontend",
    "dev:backend":      "npm run dev --prefix psp/backend",
    "build":            "npm run build --prefix psp/frontend && npm run build --prefix psp/backend",

    "setup:db":         "npm run setup:db --prefix psp/backend",
    "setup:seed":       "npm run seed --prefix psp/backend",

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
KMS_LOCAL_MASTER_KEY=       # 96-byte key, base64 encoded

# Server
PORT=8081                          # Dockerfile sets 8080 for K8s; code defaults to 8081 for local dev
PSP_CORS_ORIGIN=http://localhost:8080
PSP_URL_FRONTEND=http://localhost:8080

# Authentication (Application Mode)
JWT_SECRET=                        # HS256 signing secret (min 32 chars)
JWT_EXPIRES_IN=24h

# Next.js (browser → backend)
NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC=http://localhost:8081
```

### 8.5 Docker Compose

**`docker-compose.yml`**: one command starts the full stack, connects to MongoDB Atlas:

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8081:8080"  # host:container (Dockerfile sets PORT=8080)
    env_file: .env
    environment:
      PSP_CORS_ORIGIN: "http://localhost:8080,http://127.0.0.1:8080"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC: http://localhost:8081
    ports:
      - "8080:8080"
    env_file: .env
    depends_on:
      backend:
        condition: service_healthy

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

v3: Advanced Capabilities  (TBD: after v2 validated)
  Range queries, tokenization for recurring payments, performance visualization
  Goal: Leafy Bank integration-ready, Solutions Library publishable

v4: PSP Payment Platform + Modular Architecture  (TBD: after v3 validated)
  Backend refactored to domain modules (BIAN SD clusters) + new gateway module
  New BIAN SDs: SD-89 Merchant Relations · SD-64 Payment Order · SD-65 Payment Execution · SD-57 Card Etoken
  New collections: merchantAgreementProcedure · paymentOrderProcedure · cardEtokenProcedure
  New actors: Merchant (first-class entity with MCC risk profile, limits, settlement config)
  Goal: API-first payment platform story, MongoDB as the data backbone for a full PSP platform

v5: Agentic Fraud Investigation  (TBD: after v4 validated)
  AI pre-review on fraud trigger: MongoDB Agentic Platform (Magenta preferred)
  Goal: AI-assisted L1 draft + human confirmation loop on investigation workflow
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

### v3: Advanced Capabilities

**Theme:** Production-realism and integration readiness.

**Deliverables:**
- Save card for recurring payment (tokenization flow: addresses expert's browser cache scenario)
- Performance visualization: query time with QE vs plaintext index
- QE substring/prefix queries (if GA by then: MongoDB 8.2+)
- Leafy Bank integration scaffold (shared auth, shared API contracts)
- Solutions Library article draft
- Slide deck (ks-mongodb-writer-deck standard)

### v4: PSP Payment Platform + Modular Architecture

**Theme:** MongoDB as the data backbone of a full PSP platform, structured around BIAN Service Domains.

**Deliverables:**
- Backend refactored to domain module layout: `src/modules/<sd-cluster>/` + `src/shared/`, zero API surface change, all existing tests pass
- Four new BIAN Service Domains: SD-89 Merchant Relations, SD-64 Payment Order, SD-65 Payment Execution, SD-57 Card Etoken
- Three new collections: `merchantAgreementProcedure` (plaintext, bcrypt-hashed API keys), `paymentOrderProcedure` (intent lifecycle with TTL index), `cardEtokenProcedure` (QE:none on network token)
- Merchant as first-class actor: MCC risk category, transaction limits, settlement schedule, webhook endpoint
- PSP Payment API: `POST /gateway/payments` (create intent with idempotency key) → confirm → authorize → capture → void/refund
- Payment Order lifecycle: `initiated → confirmed → authorized → captured → settled/refunded/voided`
- Merchant context in fraud investigation: investigator sees merchant's average transaction amount, volume, risk category alongside the case
- Simulator Mode: new step 0 showing merchant creating the payment intent before customer checkout
- `shared/services/fraudTrigger.service.ts`: shared fraud evaluation extracted so both `transactions` and `gateway` modules trigger fraud cases through the same path (PSP-internal)

### v5: Agentic Fraud Investigation

**Theme:** AI-assisted investigation using MongoDB Agentic Platform (Magenta preferred).

**Deliverables:**
- AI pre-review triggered automatically when a fraud diagnosis case opens
- Agent queries QE collections (email, card token, account ref) and evaluates fraud indicators
- Agent produces a structured draft diagnosis: risk summary, recommended action, confidence score
- L1 analyst sees the AI draft inline in the case detail; confirms, overrides, or escalates
- L2 investigator sees AI context alongside sensitive field reveal
- All agent actions logged in `diagnosisActionLog` with `performedByRole: 'ai_agent'`

---

## 10. Feature Requirements

> The complete FR and NFR breakdown per iteration: with acceptance criteria and Definition of Done: is in **[docs/roadmap.md](roadmap.md)**.

The following is a high-level summary. Refer to the roadmap for the full specification.

### Summary by Iteration

| Version | Key Frontend Features | Key Backend Features |
|---|---|---|
| **v1** | Mode selector landing, simulator flow (payment + investigation + Atlas toggle), application mode (login + role-based routing) | JWT auth, QE writes, equality search, auto-fraud-case creation, `/health` endpoint |
| **v2** | Role selector (Level 1 / Level 2 / Auditor), escalation workflow, audit trail timeline | RBAC middleware, escalation endpoint, audit log queries, range queries on amount |
| **v3** | Save card / recurring payment flow, performance comparison panel | Tokenization endpoint, query-timing diagnostic endpoint, Leafy Bank API contracts |
| **v4** | Simulator step 0 (merchant creates payment intent), merchant profile panel in fraud case detail, merchant portal in Application Mode; **Ch-05 additions:** Merchant onboarding form (with test data presets), Merchant Officer dashboard (review queue), Debug Mode toggle (BIAN annotations + raw MongoDB document viewer), Enhanced Login screen (all 7 roles as clickable cards) | Backend modular refactor (BIAN SD modules), gateway API (`/gateway/payments`, `/merchants`, `/gateway/tokens`), 3 new collections (merchantAgreementProcedure · paymentOrderProcedure · cardEtokenProcedure), merchant seed data; **Ch-05 additions:** `PATCH /merchants/:id/review` (BIAN Action: Control), `merchant_officer` role, expanded `MerchantAgreementStatus` (`under_review`, `rejected`), 4 new seed users |
| **v5** | AI draft inline in case detail, agent confidence indicator, agent action log | Magenta agent integration, structured draft diagnosis output |

See [docs/roadmap.md](roadmap.md) for the complete FR and NFR specification with acceptance criteria per iteration.

---

## 11. Debug Mode Requirements (Ch-05)

Debug Mode is a demo-presenter feature that converts the application from a "business narrative" view to a "technical deep-dive" view. It is the primary tool for explaining MongoDB Queryable Encryption, BIAN alignment, and PCI DSS compliance to FSI architects and security practitioners.

### 11.1 Toggle Behaviour

- A `[⚡ Debug]` button appears in the top navigation bar.
- The toggle is only visible when the environment variable `DEMO_DEBUG_ENABLED=true` is set.
- State persists across page navigation via `localStorage` key `demo_debug_mode`.
- Toggling does not require a page reload.

### 11.2 Business Mode (Debug OFF: default)

- Clean, professional UI suitable for executive or business audience.
- No technical jargon, no ciphertext, no BIAN SD annotations.
- Forms show empty fields; user fills them in naturally.
- Login screen shows a minimal credential form.

### 11.3 Technical Mode (Debug ON)

Every UI element in the application gains technical context overlays:

| Overlay Type | Where it appears | Content |
|---|---|---|
| **BIAN Badge** | Entity cards, page headers, form sections | Service Domain chip: `SD-89 · Merchant Relations`, collection name |
| **PCI DSS Badge** | Alongside BIAN badge | Requirement citation: `PCI DSS Req 3.5.1` |
| **Field Label** | Every form/display field | QE mode: `QE:equality`, `QE:none`, or `unencrypted` |
| **Lock Tooltip** | Encrypted fields | `"Stored as BSON Binary subtype 6: server never sees plaintext"` |
| **Info Panel** | Action buttons (`[ℹ]`) | BIAN Action Term, HTTP method, MongoDB write op, PCI DSS control, business logic explanation |
| **Raw Document Panel** | Key entity pages | Live MongoDB document showing Binary ciphertext; fetched from `/api/v1/system/raw/:collection/:id` |
| **Login Cards** | Login screen | All demo users shown as role cards with one-click login |
| **Form Presets** | All forms | "Load test data" dropdown with 2–3 realistic presets per form |

### 11.4 Raw Document Viewer

- Uses the existing `GET /api/v1/system/raw/:collection/:id` endpoint (Simulator Mode infrastructure).
- Encrypted fields are displayed as `Binary('hex...')` notation: visually demonstrates QE at rest.
- A "Refresh" button re-fetches in real time.
- A copy-to-clipboard icon copies the full JSON.
- Only available for entity types that have a direct MongoDB document (transactions, merchants, fraud cases).

---

## 12. Login UX Requirements (Ch-05)

### 12.1 Business Mode Login

- Standard credential form: email/username + password fields.
- A subtle "Demo hints?" toggle reveals a list of available usernames (without passwords).

### 12.2 Debug Mode Login

- Full user card grid replaces the credential form.
- Each card shows: **Name**, **Role badge** (color-coded), **Department**, **One-click "Log in as this user"** button.
- Role badge colors: `customer`=blue, `level1_analyst`=amber, `level2_investigator`=orange, `security_auditor`=red, `merchant_officer`=purple.
- In debug mode, each card also shows: `partyInstanceReference` (SD-13 FK), `customerAuthenticationInstanceReference` (SD-91 FK).

### 12.3 Demo Users (9 total after v29)

| Display Name | Username | Role | Department | Party Ref |
|---|---|---|---|---|
| Alex Johnson | `customer@demo.com` | customer |: | PTY-001 |
| David Chen | `customer2@demo.com` | customer |: | PTY-057 |
| Amara Okafor | `customer3@demo.com` | customer |: | PTY-058 |
| Lena Fischer | `customer4@demo.com` | customer |: | PTY-059 |
| Level 1 Analyst | `analyst@bank.demo` | level1_analyst | Fraud Detection |: |
| Level 2 Investigator | `investigator@bank.demo` | level2_investigator | Fraud Investigation |: |
| Security Auditor | `auditor@bank.demo` | security_auditor | Compliance |: |
| Rachel Torres | `officer@bank.demo` | merchant_officer | Merchant Acquiring | PTY-056 |
| Olivia Moreno | `olivia.moreno@back.es` | operations_officer | Operations | b0000060 |
| Daniel Rossi | `daniel.rossi@back.es` | operations_officer | Operations | b0000061 |

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

# 3a-bis. Rebuilding from scratch (after an encryptedFields change, or to clear demo state)
npm run setup:reset        # = setup:db:reset + setup:seed, both databases

# Dropping everything first, when a collection has to disappear rather than be recreated:
npm run setup:db:drop && npm run setup:reset

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
| `npm run setup:db` | Create QE collections, provision DEKs and indexes (PSP, then every registered bank) |
| `npm run setup:db:reset` | Same, dropping and recreating existing collections first. Needed after any change to `encryptedFields`, since setup skips a collection that already exists |
| `npm run setup:seed` | Insert synthetic BIAN-compliant demo data (idempotent). Bank first, then the PSP, because the PSP's records reference the bank's |
| `npm run setup:reset` | Full rebuild: `setup:db:reset` followed by `setup:seed` |
| `npm run setup:db:drop` | Drop every bank database, then the PSP database and the shared key vault, in that order |
| `npm run test` | Run unit + integration tests (Vitest) |
| `npm run test:unit` | Unit tests only (no Atlas required) |
| `npm run test:integration` | Integration tests (requires `TEST_MONGODB_URI`) |
| `npm run test:e2e` | Playwright end-to-end browser tests |
| `npm run test:e2e:ui` | Playwright interactive UI mode |
| `npm run test:watch` | Vitest watch mode (development) |
| `npm run type-check` | TypeScript type check without emitting |

### `psp/backend/bin/setup.ts` Responsibilities

`psp/backend/bin/setup.ts` is a thin wrapper. All logic lives in `psp/backend/src/vendors/setup/`:

1. Validate environment variables (fail fast with helpful error if missing)
2. Connect to MongoDB Atlas (plain client for DEK provisioning)
3. Provision KMS provider (AWS or local based on `KMS_PROVIDER`)
4. Create or retrieve `DEK-lookup` and `DEK-sensitive` in `encryption.__keyVault`
5. Create all 7 collections using `createEncryptedCollection()` with QE schemas
6. Create all indexes per the index strategy in §6.5
7. Apply JSON Schema validation on `fraudDiagnosisCase` (plaintext collection)
8. Print setup summary: collections created, DEKs provisioned, indexes applied

### `psp/backend/bin/seed.ts` Responsibilities

`psp/backend/bin/seed.ts` is a thin wrapper. All logic lives in `psp/backend/src/vendors/seed/`:

1. Upsert demo users into `customerAuthenticationAssessment` (SD-91, hashed passwords, roles) and their corresponding `party` records (SD-13)
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
| 15 | Authentication model | Local JWT (HS256) stored in `customerAuthenticationAssessment` (SD-91); `partyAuthenticationAssessment` (SD-16) holds verification events; extensible to MS Entra ID | 2026-05-27 |
| 16 | Seeder user selection UX | Username dropdown auto-fills password on selection; dev-friendly | 2026-05-27 |
| 17 | Bin/ vs psp/backend/vendors/ | Setup/seed logic lives in `psp/backend/src/vendors/`; `bin/` are thin wrappers | 2026-05-27 |
| 18 | Version reorder | Agentic fraud investigation moved to v5 (last); old v4 Advanced Capabilities → new v3; old v5 Payment Gateway → new v4 | 2026-06-08 |

---

---

## 16. Integration Hub & Compliance Orchestration

### 16.1 Business Motivation

LeafyBank's demo currently answers two questions well:

1. *How does MongoDB protect sensitive payment data?* (Queryable Encryption, RBAC, audit trail)
2. *How does a fraud investigation workflow work?* (L1/L2/Auditor, BIAN SD-83, case lifecycle)

But it fails to answer a third question that every FSI enterprise buyer will ask:

> *"How would this integrate with our existing compliance stack: Refinitiv World-Check, FICO Falcon, Onfido, NICE Actimize, Equifax?"*

Without an answer, the demo is a standalone showcase, not a reference architecture. The Integration Hub closes this gap by formalizing every compliance function as a pluggable provider using BIAN SD-193 External Provider Arrangements.

### 16.2 The Internal-First Principle

The Integration Hub is built on a non-negotiable principle: **the demo must always work without any external provider configured**.

Every compliance function ships with a working internal default implementation. External providers are optional overrides. This means:

- The demo works offline, in air-gapped environments, and without any vendor credentials.
- A prospect can register their own provider in a live demo session and see it work end-to-end.
- The FSI architect can say: *"I can see exactly where my existing Refinitiv integration would plug in."*

### 16.3 Integration Catalog

| Integration Type | Internal Default | External Providers | BIAN SD | PCI DSS |
|---|---|---|---|---|
| `fraud_detection` | Internal amount/MCC fraud scoring (existing) | FICO Falcon, Featurespace, ThreatMetrix | SD-63 Fraud Evaluation | Req 10.2.1, 12.3.1 |
| `hrp_sanctions` | HRPC check engine: 9 categories, 4 risk levels (existing) | Refinitiv World-Check, OFAC SDN, LexisNexis | SD-13 Party Reference Data | Req 12.8.1, 12.8.5 |
| `kyc_identity` | KYC BQ:Step sub-document status (existing) | Jumio, Onfido, Socure, iDenfy | SD-53 Customer Agreement | Req 8.1, 12.8.1 |
| `kyb_business` | KYB BQ:Step sub-document status (existing) | ComplyAdvantage, Creditsafe, Onfido Business | SD-89 Merchant Relations | Req 12.8.1, 12.8.3 |
| `aml_monitoring` | Suspicious pattern analysis stub (new) | NICE Actimize, Oracle FCCM, Napier AI | SD-99 Suspicious Activity Analysis | Req 10.2.1, 12.3.1 |
| `credit_bureau` | `customerCreditRatingState` read (existing) | Experian, Equifax, TransUnion | SD-83 Customer Credit Rating | Req 12.8.1 |

### 16.4 New BIAN Service Domain: SD-193 External Provider Arrangements

SD-193 External Provider Arrangements is a BIAN service domain that manages the formal relationships between a financial institution and its third-party compliance service providers. The Integration Hub's `integrationRegistry` collection is the Control Record for this service domain.

Key SD-193 concepts mapped to LeafyBank:

| BIAN SD-193 concept | LeafyBank implementation |
|---|---|
| Control Record | `ExternalProviderArrangement`: one document per registered provider |
| BQ: Assessment | `externalProviderHealthStatus` + health check events |
| BQ: Update | API key rotation, endpoint update, trigger event reconfiguration |
| Action Log | `integrationEvents` collection: append-only audit log |
| Arrangement Status | `active | inactive | test | suspended` lifecycle |

### 16.5 New Persona: System Administrator

**Role:** `system_admin`  
**Name (demo):** "Alex Morgan, Integration & Compliance Technology Manager"  
**Avatar:** Slate, `bg-slate-600`

The System Administrator is the business-side owner of the compliance integration stack. They are not a developer (they don't restart servers or edit config files) and not a fraud analyst (they don't investigate cases). Their job is to ensure the bank's automated compliance functions are properly configured, tested, and auditable. Their remit is system and platform governance (integrations/providers, auth domains, roles, general config, security), not business or cardholder data. As of v29.2 their relation to the internal modules is **read-only** (`modules:view`, system and security oversight): editing internal module config and policies belongs to the `operations_officer`, who owns internal business logic and financial processes. (Note: this platform-admin persona is labelled `system_admin` here but maps to the `manager` role in the RBAC matrix of `technical-spec.md` §1.15.)

**User stories:**

| Story | Persona | As a... | I want to... | So that... |
|---|---|---|---|---|
| US-v6-01 | System Admin | System Administrator | see all registered compliance providers and their health status on a single dashboard | I can verify our entire compliance stack is operational at a glance |
| US-v6-02 | System Admin | System Administrator | register a new external fraud detection provider with its endpoint and API key | my team can switch from internal scoring to a specialized FDS without code changes |
| US-v6-03 | System Admin | System Administrator | rotate an API key for a registered provider | I can comply with PCI DSS Req 12.8.5 without disrupting the integration |
| US-v6-04 | System Admin | System Administrator | test connectivity to a registered provider and see the response latency | I can validate the integration before activating it in production |
| US-v6-05 | System Admin | System Administrator | view the audit log of all provider interactions (dispatches, callbacks, tests) | I can satisfy PCI DSS Req 10.2.1 audit requirements for automated compliance functions |
| US-v6-06 | System Admin | System Administrator | suspend a provider that is failing or has a compliance issue | I can fall back to the internal default without service disruption |
| US-v6-07 | FSI Architect | Demo observer | see the three internal providers pre-configured with "Built-in" badges | I understand the system works without vendor credentials, and I know exactly where my stack plugs in |

### 16.6 Integration Flow: Fraud Detection (example end-to-end)

```
Customer submits payment
        │
        ▼
POST /api/v1/transactions
        │
        ▼
fraudDiagnosis.service.ts
  ├── Compute internal fraud score (always runs)
  ├── Check: is active external FDS registered?
  │     Yes → dispatchIntegration('fraud_detection', event)
  │           ├── Sync mode: HTTP POST to external endpoint, await response
  │           │   └── Update fraud case with externalFraudScore + recommendation
  │           └── Log IntegrationEvent { type:'dispatch', latencyMs, status }
  │     No → use internal score only
  └── Create fraud case if score > threshold
```

**Fallback behavior**: If the external provider returns an error, times out, or is unreachable, the system falls back to the internal fraud score. The fallback is logged as an `IntegrationEvent` with `status: 'error'`. The fraud investigation workflow continues uninterrupted.

### 16.7 PCI DSS Compliance Coverage

The Integration Hub is designed around PCI DSS v4.0 third-party service provider requirements:

| PCI DSS Requirement | Integration Hub response |
|---|---|
| Req 12.8.1: Maintain list of all TPSPs | `integrationRegistry` is the maintained list; each provider has name, type, endpoint, status, and PCI DSS requirement mapping |
| Req 12.8.2: Written agreement | `externalProviderArrangementStatus` lifecycle tracks the agreement state; BQ:Update logs all changes |
| Req 12.8.3: Due diligence before engagement | `externalProviderLastHealthCheckAt` + `POST /test` result stored as evidence |
| Req 12.8.5: Monitor compliance status | Health check events + health status field; key rotation tracked via rotate-key events |
| Req 10.2.1: Audit log of system access | Every dispatch, callback, and key rotation creates an `IntegrationEvent` record |
| Req 10.7: Retain logs ≥ 90 days | TTL index on `integrationEvents`: 7776000 seconds |
| Req 6.3.3: Protect credentials | bcrypt hash storage; plaintext key shown once and never stored |
| Req 7.1: Separation of Duties | `system_admin` (business) vs devops `admin` (infrastructure), distinct roles with disjoint capabilities |

### 16.8 Demo Narrative for FSI Presentations

**Scene 1 (no external providers):** Present the system to an FSI team. Everything works, fraud scoring, KYC, merchant onboarding. Show the integration dashboard with 3 built-in providers. Explain: "This is a fully functional compliance system with no vendor dependencies. Zero configuration required."

**Scene 2 (live registration):** An architect says "we use Refinitiv World-Check." Open the admin portal → register a new `hrp_sanctions` provider with the Refinitiv endpoint and API key → test it → activate it. The HRPC check is now routed to Refinitiv. Show the event log. Explain: "The next HRPC check will use your provider, and if it fails, the system falls back to our internal check automatically."

**Scene 3 (audit):** Open the integration event log. Show PCI DSS Req 10.2.1 compliance, every provider interaction is logged. Open the integration registry. Explain: "This IS your PCI DSS Req 12.8.1 third-party service provider list. Every provider you register is automatically documented."

### 16.9 Decision Log

| # | Decision | Choice | Rationale | Date |
|---|---|---|---|---|
| D-v6-01 | Internal vs external first | Internal-First pattern (ADR-010) | Demo reliability; preserves existing HRPC/KYC/KYB work; offline capable | 2026-06-10 |
| D-v6-02 | New admin role vs extend existing | New `system_admin` role (ADR-011) | PCI DSS Req 7.1 Separation of Duties; distinct business vs devops persona | 2026-06-10 |
| D-v6-03 | Registry storage | MongoDB collection as SD-193 (ADR-012) | Full BIAN citation; runtime updates; audit log; key hashing; UI management | 2026-06-10 |
| D-v6-04 | API key security | bcrypt hash, shown once | Industry standard (matches Stripe, GitHub token model); PCI DSS Req 6.3.3 | 2026-06-10 |
| D-v6-05 | Callback authentication | HMAC-SHA256 `X-Webhook-Signature` | Standard pattern (Stripe, GitHub webhooks); no JWT required for inbound | 2026-06-10 |
| D-v6-06 | Event log retention | TTL index 90 days | PCI DSS Req 10.7 minimum retention; avoids unbounded collection growth | 2026-06-10 |

---

*This document is a living artifact. Update the Decisions Log with any architectural or scope change agreed during development.*

## Bank Transfers (ACH / SEPA / SWIFT): capability add-on

> Delivered under development plan v17 (dev-plan tranche "v17.1"), not a numbered product release.

The PSP supports outbound bank transfers over ACH, SEPA and SWIFT, to registered accounts and to
unregistered accounts (details entered on a form). All transfers are external bank transfers executed
through providers (BIAN SD-65/66): the rail is auto-derived (with override) and validated per standard
(ISO 13616 IBAN, ISO 9362 BIC, NACHA ABA), fees are quoted per rail, and a pre-initiation risk gate
(FDS/HRP/AML) blocks and opens an L1-reviewable fraud case on a negative evaluation. Recurring payments
(ACH Direct Debit, SEPA SDD) are supported via mandates. PCI DSS: bank coordinates are transaction-scoped
and never travel on the bus; every transfer is audited (Req 10) with the execution reference as correlation id.

*Added 2026-07-04 (v17.1).*
