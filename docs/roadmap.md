# Roadmap: FR & NFR per Iteration

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-06-10

---

## Iterations at a glance

| Version | Theme | Goal | Target timeline |
|---|---|---|---|
| **v1** | Security Foundation | Working end-to-end: payment → QE encryption → fraud investigation | 2–3 weeks |
| **v2** | Investigation & Control | CISO (Chief Information Security Officer)  ready: RBAC, escalation, audit trail, KMS key rotation | 4–6 weeks after v1 |
| **v3** | Integration-ready API Surface | Expose stable webhook events and API contracts that external systems can consume; recurring payment; performance story. External adoption (e.g. Leafy Bank) is decoupled and does not gate this iteration. | TBD after v2 validated |
| **v4** | PSP Payment Platform + Integration Refinement | Full PSP payment layer (SD-64/65/89/57), modular backend, finalised OpenAPI contracts and webhook schemas for external integrators. | TBD after v3 validated |
| **v5** | Agentic Integration | AI agent integration for fraud investigation: MongoDB Agentic Platform (Magenta) and/or external agentic systems such as Agentic ThreatSight360. | TBD after v4 validated |

---

## BIAN Compliance Status *(achieved 2026-06-08)*

All collection names, type suffixes, and `bianServiceDomain` values were brought into strict BIAN compliance as a pre-v1 alignment pass. This is not a new iteration — it is a baseline correction that all iterations (v1–v5) inherit.

| Compliance decision | Standard | Status |
|---|---|---|
| PII separated into SD-13 `party` collection | BIAN SD-13 | ✅ Done |
| Auth credentials in SD-91 `customerAuthenticationAssessment` | BIAN SD-91 | ✅ Done |
| Collection names use BIAN Control Record type suffixes | BIAN naming convention | ✅ Done |
| `bianServiceDomain` values use BIAN catalogue names with spaces | BIAN SD catalogue | ✅ Done |
| Open Banking consent stubs `consentAgreement` + `consentAccessLog` | SD-36 | ✅ Done (v3 stub) |
| FK names use `*InstanceReference` suffix | BIAN FK convention | ✅ Done |
| Expanded lifecycle states (all BIAN-defined states on model types) | BIAN lifecycle | ✅ Done |
| DEK-per-field naming (11 DEKs) | QE best practice | ✅ Done |

**Impact on NFRs:** email/phone lookup P95 threshold updated from 300 ms to 500 ms due to two-step PII separation pattern (SD-13 query + SD-53 join). See `tmp/wiki/bian-openbanking-tradeoffs.md §1` for full analysis.

---

## v1: Security Foundation

### Objective

Deliver a runnable demo that proves MongoDB Queryable Encryption works end-to-end: a user submits a card payment, fields are encrypted client-side, and a fraud analyst finds the record by searching an encrypted field. The server never decrypts that field.

### Definition of Done

- [ ] `npm run setup && npm run setup:db && npm run setup:seed` completes without errors
- [ ] `docker compose up` starts both services and the demo is accessible at `http://localhost:3000`
- [ ] Payment flow completes and creates a fraud diagnosis case in Atlas
- [ ] Investigation search returns a result for an encrypted `customerEmailAddress`
- [ ] Atlas Data Explorer shows ciphertext in QE fields (not plaintext)
- [ ] Local KMS fallback works with `KMS_PROVIDER=local`
- [ ] Zero TypeScript build errors

---

### FR-v1: Functional Requirements

#### FR-v1-01: Payment Simulation (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 01.1 | 3-step checkout form: Card Details → Review → Confirm | User completes all three steps; back navigation is supported |
| 01.2 | Card number field masks input immediately as `****-****-****-XXXX` | No raw digits are visible after entry; the field shows the last 4 only |
| 01.3 | Frontend generates a card token before calling the API | Raw PAN is never sent over the wire; the API receives only the token |
| 01.4 | Visual indicator: "Fields encrypted before leaving your browser" | Lock icon and label appear during Review step |
| 01.5 | On submission success: show Transaction ID, masked PAN, timestamp, and fraud alert banner | All four elements are displayed on the confirmation screen |
| 01.6 | Fraud alert links directly to the Investigation dashboard for that case | Clicking the alert opens the case detail view |

#### FR-v1-02: Fraud Investigation Dashboard (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 02.1 | Search bar with field selector: `email` \| `phone` \| `account reference` \| `card token` | Selector is visible; only one field can be searched at a time |
| 02.2 | Results table shows: Transaction ID, Masked PAN, Amount, Merchant, Status, Risk Severity | All six columns are present; values are accurate |
| 02.3 | Case detail panel shows QE field indicators (lock icon on encrypted fields) | Lock icon is shown on `customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`; card token shown as plaintext with a label |
| 02.4 | "Encrypted in Atlas" toggle shows raw document view with ciphertext blobs | Toggle switches between business view and raw document; ciphertext is visible in raw view |
| 02.5 | Cases list supports filter by status and risk severity | Filters update results without page reload |

#### FR-v1-03: Payment API (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 03.1 | `POST /api/v1/transactions` writes to `cardTransactionLog` via QE auto-encryption (QE:none fields stored inline) | QE equality and QE:none fields in Atlas are ciphertext; plaintext fields are readable |
| 03.2 | `POST /api/v1/customer/:customerId/cards` registers a tokenized card in `paymentCardManagement` | Card token stored encrypted; expiry date stored as QE:none |
| 03.3 | `GET /api/v1/transactions/:id` returns transaction by ID | Response includes transaction metadata; sensitive fields excluded from Level 1 response |
| 03.4 | Auto-create a `fraudDiagnosisCase` when amount > 500 or MCC is in a risk list | Case is created and linked to the transaction on every triggering event |
| 03.5 | `GET /api/v1/system/health` returns 200 with Atlas connection status | Returns `{ status: "ok", atlas: "connected", kmsProvider, timestamp }` when Atlas is reachable; returns 503 when unreachable |

#### FR-v1-04: Investigation API (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 04.1 | `GET /api/v1/customer?email=<value>` performs QE equality search | Returns matching record when email value matches an encrypted field |
| 04.2 | `GET /api/v1/customer?phone=<value>` performs QE equality search | Returns matching record when phone value matches |
| 04.3 | `GET /api/v1/customer?accountRef=<value>` performs QE equality search | Returns matching record when account reference matches |
| 04.4 | `GET /api/v1/transactions?cardToken=<value>` performs standard index query on `paymentCardReference` | Returns matching transactions for the given card token (token is not CHD: standard index, not QE) |
| 04.5 | `GET /api/v1/fraud` returns paginated list with filters `status` and `severity` | Filtering works; response includes pagination metadata |
| 04.6 | `GET /api/v1/fraud/:id` returns full case detail | Response includes linked transaction reference and customer reference |

#### FR-v1-05: Authentication (Backend + Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 05A.1 | `POST /api/v1/auth/login` validates credentials against `customerAuthenticationAssessment` (SD-91) and returns a JWT | Valid credentials return `{ token, user: { name, email, role } }`; invalid credentials return 401 |
| 05A.2 | `GET /api/v1/auth/users` returns list of demo users (name, email, role) without passwords | Response used by frontend user selector dropdown |
| 05A.3 | Application Mode login screen shows domain selector (`local`) and username dropdown | Selecting a username auto-fills the password field |
| 05A.4 | JWT is verified on all protected `/api/v1/*` endpoints | Missing or invalid token returns 401 |
| 05A.5 | Demo user accounts (5 users) are seeded by `bin/seed.ts` | All 5 users exist with correct roles and bcrypt-hashed passwords after seeding |

#### FR-v1-06: Database Setup & Seeding (bin/)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 06.1 | `bin/setup.ts` creates all QE collections via `createEncryptedCollection()` (5 QE collections: `party`, `customerAuthenticationAssessment`, `customerAgreementProcedure`, `cardTransactionLog`, `paymentCardManagement`) | All collections exist in Atlas after setup; QE metadata is provisioned |
| 06.2 | `bin/setup.ts` provisions 11 DEKs in `encryption.__keyVault`: `partyEmail`, `partyPhone`, `authEmail`, `customerAccountRef`, `txAccountRef`, `customerAddress`, `customerGovId`, `customerRiskNotes`, `txRawPayload`, `txProcessorMeta`, `cardExpiry` | Key vault contains exactly 11 DEK documents after setup |
| 06.3 | `bin/setup.ts` creates all indexes defined in the Technical Specification | Index exists on every field listed in the index strategy |
| 06.4 | `bin/seed.ts` inserts synthetic BIAN-compliant data into all collections | 53 parties, 5 demo users, 50 customers, 50 sensitive records, 50 cards, 200 transactions, 200 sensitive transactions, 20 fraud cases |
| 06.5 | `bin/seed.ts` is idempotent: safe to re-run without creating duplicates | Running seed twice produces the same number of documents |

---

### NFR-v1: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v1-01 | Performance | API response time for QE equality search under normal load | P95 < 300 ms on Atlas M10 |
| NFR-v1-02 | Setup | Full environment setup and seed completes on a clean machine | < 5 minutes end-to-end |
| NFR-v1-03 | Security | No plaintext PAN, CVV, or PIN appears in any log, response, or database field | Manual audit pass + grep on seed data output |
| NFR-v1-04 | Security | AWS credentials and Atlas URI are never committed to the repository | `.env` is in `.gitignore`; `.env.example` has no real values |
| NFR-v1-05 | Reliability | `docker compose up` starts both services and health check passes | Both containers reach healthy state within 60 seconds |
| NFR-v1-06 | Portability | Demo runs offline with `KMS_PROVIDER=local` | Full payment-to-investigation flow works without network access to AWS |
| NFR-v1-07 | Code quality | Zero TypeScript errors at build time | `npm run build` exits with code 0 |
| NFR-v1-08 | Explainability | A non-technical AE can run the full demo after one practice session | Validated by IST team walkthrough |

---

## v2: Investigation & Control

### Objective

Answer the CISO's hardest questions: *"Who can see what?"* and *"Can I prove it?"* Add multi-role access control, an escalation workflow that reveals sensitive QE:none fields, an audit trail viewer, and a key rotation demonstration.

### Definition of Done

- [ ] All v1 DoD criteria still pass
- [ ] Role selector on login screen; role badge visible throughout session
- [ ] Level 1 Analyst search returns results without sensitive fields
- [ ] Level 2 Investigator can trigger escalation and see sensitive fields after approval
- [ ] Audit trail shows every field-access event for a given case
- [ ] QE range query on `transactionAmount.amount` works (e.g., "find transactions between $200 and $1000")
- [ ] KMS key rotation walkthrough is demonstrable (step-by-step in the UI or docs)
- [x] Case notes as BIAN append-only events (`POST`/`DELETE`/`GET /api/v1/fraud/:id/notes`)
- [x] Customer-visible notes list in transaction detail
- [x] Note retraction with audit event (BIAN + PCI DSS Req 10.3 compliant)
- [x] `escalationAcceptedAt` persisted on case document (L2 accept survives refresh)

---

### FR-v2: Functional Requirements

#### FR-v2-10: Role Simulation (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 10.1 | Login screen with persona selector: Level 1 Analyst / Level 2 Investigator / Security Auditor | Three personas are available; selecting one sets the demo session role |
| 10.2 | Role badge visible in the navigation bar throughout the session | Badge shows role name and a role-specific color |
| 10.3 | Sensitive fields (`residentialAddressFull`, `governmentIdentificationReference`) show a lock icon for Level 1 | Fields are hidden and only a lock icon is visible in case detail |
| 10.4 | Level 2 sees a "Reveal sensitive fields" button after escalation approval | Button appears only in escalated cases for Level 2 role |

#### FR-v2-11: Escalation Workflow

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 11.1 | Level 1 can trigger an escalation request on an open case | `POST /api/v1/fraud/:id/escalate` changes status to `escalated` |
| 11.2 | Level 2 Investigator sees pending escalation cases in a dedicated queue | Cases with status `escalated` appear in the Level 2 dashboard |
| 11.3 | Level 2 approves and sensitive QE:none fields are decrypted and displayed | `residentialAddressFull` and `governmentIdentificationReference` are shown after approval |
| 11.4 | Escalation approval writes an audit event with timestamp, role, and field names accessed | Audit event persists in `fraudDiagnosisCase.diagnosisActionLog` |

#### FR-v2-12: Audit Trail Viewer (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 12.1 | Per-case timeline shows: datetime, action type, performing role, details | All four columns are present in the timeline |
| 12.2 | Timeline is sortable by datetime (ascending / descending) | Clicking the date header toggles sort direction |
| 12.3 | Timeline is filterable by action type (case_opened, field_accessed, escalated, case_closed) | Filter dropdown updates timeline without page reload |

#### FR-v2-13: RBAC API Layer (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 13.1 | API reads role from `X-Demo-Role` request header | Missing header defaults to `level1_analyst` |
| 13.2 | Level 1 requests use the L1 QE client, which omits QE:none fields from its `encryptedFieldsMap`; Binary ciphertext fields are stripped from Level 1 API responses | No sensitive fields (address, govId, rawGatewayPayload) appear in Level 1 responses |
| 13.3 | Level 2 access to QE:none fields requires a valid escalation token to activate the L2 QE client | Request without escalation token returns 403 |
| 13.4 | Every sensitive field access writes an audit event | `field_accessed` event is appended to the case action log |

#### FR-v2-14: Audit Log API

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 14.1 | `GET /api/v1/audit-events?caseId=<id>` returns action log for the case | Response contains all events in chronological order |
| 14.2 | `POST /api/v1/fraud/:id/escalate` creates escalation record | Status changes to `escalated`; escalation event is logged |

#### FR-v2-15: Range Query Support (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 15.1 | `GET /api/v1/transactions?amountMin=<n>&amountMax=<n>` performs QE range query on `transactionAmount.amount` | Returns only transactions within the encrypted amount range |
| 15.2 | `transactionAmount.amount` is defined in `encryptedFieldsMap` with `queryType: "range"`, `min: 0`, `max: 999999`, `precision: 2` | QE range query executes without error |

---

### NFR-v2: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v2-01 | Performance | QE range query on amount responds under normal load | P95 < 500 ms on Atlas M10 |
| NFR-v2-02 | Security | RBAC enforcement: Level 1 cannot access sensitive collections regardless of token manipulation | Security test: forged `X-Demo-Role: level2_investigator` without escalation token returns 403 |
| NFR-v2-03 | Auditability | Every sensitive field reveal is persisted in the action log | No reveal occurs without a corresponding audit event |
| NFR-v2-04 | Maintainability | Adding a new demo role requires changes in one place: the RBAC middleware | New role added without modifying controllers or services |
| NFR-v2-05 | Backward compatibility | v1 API endpoints continue to work unchanged | v1 integration test suite passes without modification |

---

### Ch-03 / Architecture Changes *(implemented 2026-06-10)*

These changes were applied during v2 development and are now part of the v2 baseline. All v2 acceptance criteria inherit them.

| Change | Detail | Status |
|---|---|---|
| Case notes migrated to append-only events | `POST /api/v1/fraud/:id/notes`, `DELETE /api/v1/fraud/:id/notes/:noteId`, and `GET /api/v1/fraud/:id/notes` replace the deprecated note fields on the `PATCH` endpoint. Each note is stored as an immutable `note_added` event in `fraudDiagnosisCaseEvents`. Errors are corrected via a `note_retracted` event (BIAN SD-83 append-only principle, PCI DSS Req 10.3). | ✅ Done |
| `escalationAcceptedAt` on case document | `GET /api/v1/fraud/:id` now returns `escalationAcceptedAt`. The timestamp is persisted on the `fraudDiagnosisCase` document when a Level 2 Investigator approves an escalation, so the approval state survives a page refresh. | ✅ Done |
| Deprecated: `fraudDiagnosisCaseNotes` | The single-string `fraudDiagnosisCaseNotes` field on `fraudDiagnosisCase` is **deprecated**. New writes must use the notes event endpoints above. Existing seed data retains the field for backward compatibility; it will be removed in v3. | ⚠️ Deprecated |
| Deprecated: `fraudDiagnosisCustomerSubjectNotes` | The single-string `fraudDiagnosisCustomerSubjectNotes` field is **deprecated** for the same reason. Customer-visible notes are now the chronological list of `visibility:'customer'` events returned by `GET /api/v1/fraud/:id/notes`. | ⚠️ Deprecated |

---

## v3: Advanced Capabilities

### Objective

Expose the integration-ready API surface that external systems can consume without this demo having to wait for them. Add the save-card / recurring payment flow, stable webhook event contracts, a performance visualisation, and optionally prefix/substring QE (Queryable Encryption) queries if MongoDB 8.2 is available.

External systems such as Leafy Bank or Agentic ThreatSight360 **may** consume the endpoints and events published in this iteration, but their adoption is entirely decoupled. If a peer system has not yet performed its own refactoring, the PSP platform roadmap is unaffected: v3 is complete when the contracts are published and the PSP implements them, regardless of whether any external consumer has integrated.

### Definition of Done

- [ ] All v1 and v2 DoD criteria still pass
- [ ] "Save this card for future payments" flow works end-to-end
- [ ] Returning customer can select a saved card and complete payment without re-entering card details
- [ ] Performance comparison panel shows query time with QE vs a plaintext reference collection
- [ ] Webhook event payloads for card-lifecycle and transaction-created events are documented in technical-spec.md
- [ ] API contracts for all v3 endpoints are stable, versioned, and documented in technical-spec.md
- [ ] Solutions Library article draft is created (ks-mongodb-ist-content checklist complete)

---

### FR-v3: Functional Requirements

#### FR-v3-20: Save Card / Recurring Payment (Frontend + Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 20.1 | After successful payment, a consent checkbox "Save this card for future payments" appears unchecked by default | Checkbox is visible on the confirmation screen; requires explicit opt-in |
| 20.2 | Accepting consent records `isPreferredCard: true`, `mandateStatus: 'active'`, and `cardholderConsentTimestamp` in `paymentCardManagement` | All three mandate fields are present in the Atlas document |
| 20.3 | `customerAgreementProcedure.preferredPaymentCardReference` is updated to link to the saved card token | Field equals the `paymentCardReference` of the saved card |
| 20.4 | On next payment, "Use saved card ****-1234" option appears | Saved card is retrieved via `preferredPaymentCardReference` from the customer agreement |
| 20.5 | Selecting a saved card completes checkout without re-entering card details; CVV is never requested | Card transaction is created with `cardTransactionInitiationType: 'merchantInitiated'`; no CVV field in the flow |
| 20.6 | Mandate can be cancelled: `mandateStatus` updates to `'cancelled'` and the card is no longer offered | Cancelled card does not appear on next payment; `preferredPaymentCardReference` is cleared |
| 20.7 | Explainer panel: "No card data is stored in your browser: only a token, encrypted in Atlas" | Panel is visible on the saved card selection screen |

#### FR-v3-21: Performance Visualization (Backend + Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 21.1 | `GET /api/v1/diagnostics/query-timing` runs the same equality search on the encrypted collection and a plaintext shadow collection | Both queries execute and timing data is returned |
| 21.2 | Response includes timing in milliseconds for both queries | `{ encrypted_ms: number, plaintext_ms: number, overhead_pct: number }` |
| 21.3 | Frontend displays a side-by-side comparison panel with the timing values | Panel is visible in the investigation dashboard; values update on each search |

#### FR-v3-22: External Integration API Surface

This feature exposes the contracts and events that any external system can consume. No external system is required to adopt them in v3; this iteration is complete when the PSP platform publishes the contracts, not when a consumer has integrated.

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 22.1 | All v3 API endpoints follow a stable versioned contract (`/api/v1/`) and are fully documented in technical-spec.md before merge | technical-spec.md §6 covers every new endpoint introduced in v3 with request/response schema |
| 22.2 | Card-lifecycle events (card registered, card updated, mandate changed) are emitted as structured webhook payloads | Webhook payload schema documented in technical-spec.md; event is emitted on each trigger |
| 22.3 | Transaction-created event is emitted after every successful `POST /api/v1/transactions` | Event payload includes `cardTransactionInstanceReference`, `paymentCardReference`, `cardTransactionAmount`, `cardTransactionStatus` |
| 22.4 | Authentication contract for service-to-service callers is defined: JWT header structure, required claims, and role mapping | Documented in technical-spec.md; a `level1_analyst` or `level2_investigator` service credential can authenticate without a frontend session |

---

### NFR-v3: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v3-01 | Performance | QE overhead for equality search is below a defined threshold | Overhead < 20% vs plaintext on Atlas M10 under single-user demo load |
| NFR-v3-02 | UX | Returning customer payment with saved card completes in fewer steps than first-time payment | Saved card flow requires ≤ 2 steps vs 3 for new card |
| NFR-v3-03 | Portability | Any external system with a service credential can call all v3 endpoints without changes to the PSP platform | Validated by IST team design review against the published integration contract in technical-spec.md; no dependency on external team availability |
| NFR-v3-04 | Content readiness | Solutions Library article passes the four-section template check | Validated using ks-mongodb-ist-content checklist |

---

## v4: Payment Gateway + Modular Architecture

### Objective

Extend the demo from a **fraud investigation tool** to a **full payment platform story**: MongoDB as the PCI DSS-aligned data backbone for a PSP platform. The backend is restructured into domain modules (one per BIAN SD cluster) and a new gateway module adds four BIAN Service Domains (SD-89, SD-64, SD-65, SD-57), three collections, and a full payment order lifecycle API. The frontend adds the merchant as a visible actor in the demo flow.

The structural refactor (P1) has zero functional impact: same API surface, same QE behaviour, same frontend. The gateway module (P2–P5) adds new capabilities on top.

v4 also finalises the external integration surface introduced in v3: OpenAPI schemas are published for all PSP payment endpoints, webhook contracts are versioned, and the OAuth (Open Authorization) 2.0 groundwork is documented so that external systems (such as Leafy Bank's Open Finance Service or Agentic ThreatSight360) can integrate at their own pace without requiring changes to the PSP platform. Integration by external systems is optional and does not gate any v4 acceptance criteria.

### Definition of Done

- [ ] All v3 DoD criteria still pass
- [ ] `npm run build` exits 0; no TypeScript errors after structural refactor
- [ ] No file remains in `backend/src/controllers/`, `backend/src/services/`, `backend/src/models/`, `backend/src/middleware/` (all moved to modules)
- [ ] `npm run setup:db` creates `merchantAgreementProcedure`, `paymentOrderProcedure`, `cardEtokenProcedure` collections
- [ ] Atlas Data Explorer confirms `merchantApiKeyHash` is ciphertext (QE:none)
- [ ] `POST /api/v1/gateway/payments` creates a payment order with status `initiated`
- [ ] Full authorize flow: create → confirm → authorize creates a linked `cardTransactionLog` entry and `fraudDiagnosisCase` (if MCC/amount triggers)
- [ ] Idempotency: duplicate `X-Idempotency-Key` returns 409
- [ ] Merchant profile panel visible in fraud case detail (merchant name, MCC, risk category, amount ratio)
- [ ] Simulator Mode step 0 shows merchant creating the payment intent

---

### FR-v4: Functional Requirements

#### FR-v4-P1: Backend Structural Refactor (no functional change)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P1.1 | All backend source files moved to `src/modules/<module>/controllers/services/models/` | No file remains in the old flat `src/controllers/`, `src/services/`, `src/models/` directories |
| P1.2 | Shared types extracted to `src/shared/models/` (`risk`, `identity`, `transaction`) | `RiskSeverity`, `AnalystRole`, `TransactionSnapshot` imported from `shared/models/` in all consuming modules |
| P1.3 | Each module exports a single Fastify plugin via `index.ts`; `server.ts` registers modules with `prefix: '/api/v1'` | All existing routes respond with identical status codes and response shapes as before the refactor |
| P1.4 | `middleware/auth.ts` and `rbac.ts` moved to `vendors/middleware/` | Imports updated in `server.ts`; middleware behaviour unchanged |
| P1.5 | `models/index.ts` barrel deleted; each module imports from its own `models/` directory | `grep -r "from '../models'" backend/src/modules` returns zero results |

#### FR-v4-P2: Merchant Relations (SD-89)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P2.1 | `POST /api/v1/merchants` creates a `merchantAgreement` document with all required BIAN fields | Document visible in Atlas; `merchantApiKeyHash` is ciphertext (QE:none) |
| P2.2 | `GET /api/v1/merchants/:id` returns merchant profile without `merchantApiKeyHash` | Response includes `merchantName`, `merchantCategoryCode`, `merchantRiskCategory`, `merchantTransactionLimitAmount`; hash field absent |
| P2.3 | `GET /api/v1/merchants` returns paginated merchant list with filters `status` and `mcc` | Pagination metadata present; filter by `merchantCategoryCode=5812` returns only gambling/restaurant merchants |
| P2.4 | `cardTransactionLog` documents include `merchantAgreementInstanceReference` FK after v4 seed | FK links transaction to a seeded merchant; existing transactions without FK are valid (optional field, schema version 2) |

#### FR-v4-P3: Payment Order Lifecycle (SD-64 + SD-65)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P3.1 | `POST /api/v1/gateway/payments` creates a `paymentOrder` with status `initiated`; requires `X-Idempotency-Key` header | Order created; second call with same key returns 409 |
| P3.2 | `POST /api/v1/gateway/payments/:id/confirm` transitions `initiated → confirmed`; sets `customerAgreementInstanceReference` | Status updated in Atlas; invalid transitions (e.g., confirm a voided order) return 422 |
| P3.3 | Authorization step creates a `cardTransactionLog` entry (SD-254) and links it to the `paymentOrder` | `paymentOrder.linkedCardTransactionReference` populated; transaction visible in the investigation dashboard |
| P3.4 | Authorization triggers fraud evaluation if amount/MCC criteria met | `fraudDiagnosisCase` created and linked; uses `shared/services/fraudTrigger.service.ts` |
| P3.5 | `POST /api/v1/gateway/payments/:id/capture` transitions `authorized → captured` | Status updated; only valid from `authorized` state |
| P3.6 | `DELETE /api/v1/gateway/payments/:id` (void) transitions `authorized | confirmed → voided` | Status updated; no `cardTransaction` reversal required in v4 (documented limitation) |
| P3.7 | `POST /api/v1/gateway/payments/:id/refund` records a partial or full refund; transitions `captured → refunded` | `refundAmount` recorded; amount validation against original amount |
| P3.8 | `GET /api/v1/gateway/payments/:id` returns full payment order with current status and routing decision | Response includes `paymentOrderStatus`, `routingDecision.processor`, `linkedCardTransactionReference` |
| P3.9 | `paymentOrder` TTL index expires stale `initiated` orders after 24 hours | MongoDB removes expired `initiated` orders automatically (verified in Atlas) |

#### FR-v4-P4: Token Vault (SD-57)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P4.1 | `POST /api/v1/gateway/tokens` creates a `tokenVault` record linked to a `customerAgreementProcedure` | Record visible in Atlas; `tokenVaultNetworkToken` is ciphertext if populated |
| P4.2 | `GET /api/v1/gateway/tokens/:token` returns token metadata without `tokenVaultNetworkToken` | Response includes `tokenVaultStatus`, `tokenVaultCreatedAt`, `tokenVaultLastUsedAt`; network token absent |

#### FR-v4-P5: Frontend — Merchant Context

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P5.1 | Simulator Mode: step 0 "Merchant creates payment intent" is inserted before the checkout step | Step visible; shows merchant card (name, MCC, risk category) and the generated payment order reference |
| P5.2 | Fraud case detail (Simulator + Application Mode): "Merchant Profile" panel shows merchant name, MCC description, risk category, average transaction amount, and amount ratio | Panel visible; ratio calculated as `transactionAmount / merchantAverageTransactionAmount`; label "78x merchant average" when ratio ≥ 10 |
| P5.3 | Application Mode: route `/system/merchant` accessible to users with role `customer` | Route loads without errors; shows merchant's payment links, checkout sessions, and profile |

#### FR-v4-P6: Merchant Onboarding Lifecycle (Ch-05)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P6.1 | Customer can submit a merchant application via `POST /api/v1/merchants` — application starts at `under_review` | Atlas document has `merchantAgreementStatus: 'under_review'`; `merchantOwnerPartyReference` FK populated from JWT |
| P6.2 | `merchant_officer` role can list all pending applications via `GET /api/v1/merchants?status=under_review` | Officer dashboard shows applications with merchant name, category, owner, submitted date |
| P6.3 | `merchant_officer` can approve an application via `PATCH /api/v1/merchants/:id/review` — body `{ action: 'approve', reviewNote: '...' }` | Status transitions to `agreed`; `merchantReviewedByPartyReference`, `merchantReviewedDateTime`, `merchantReviewNote` populated |
| P6.4 | `merchant_officer` can reject an application via `PATCH /api/v1/merchants/:id/review` — body `{ action: 'reject', reviewNote: '...' }` | Status transitions to `rejected`; review metadata populated |
| P6.5 | Webhook event `merchant.agreement.activated` is emitted when a merchant is approved | Event payload includes `merchantAgreementInstanceReference`, `merchantName`, `reviewedByPartyReference` |
| P6.6 | Frontend: `/system/merchant` shows "Request Merchant Account" form when authenticated customer has no linked merchant | Form includes all required BIAN fields; "Load test data" dropdown with 3 presets |
| P6.7 | Frontend: after submission, merchant portal shows "Application under review" state with application details | Status badge displayed; timestamp shown |
| P6.8 | Frontend: `/system/merchant/review` route accessible to `merchant_officer` — shows pending applications queue | Each card has Approve / Reject buttons; review notes input field |
| P6.9 | Seed data: `backend/data/merchants.json` contains 3 records — 1 `active`, 1 `under_review`, 1 `active` (different owner) | `npm run db:seed` inserts all 3 without error |

#### FR-v4-P7: Debug Mode (Ch-05)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P7.1 | `[⚡ Debug]` button visible in top nav bar when `DEMO_DEBUG_ENABLED=true` env var is set | Button absent when env var is absent or false |
| P7.2 | Toggle persists across navigation via `localStorage` key `demo_debug_mode` | Reload browser tab — debug state unchanged |
| P7.3 | When debug ON: every entity card shows a BIAN Service Domain chip (e.g., `SD-89 · Merchant Relations`) | Chip visible on merchant cards, transaction cards, case cards |
| P7.4 | When debug ON: every encrypted field shows a lock icon with QE mode tooltip | Tooltip text: `"QE:equality — BSON Binary subtype 6 · PCI DSS Req 3.5.1"` |
| P7.5 | When debug ON: key entity pages show a `DebugRawDoc` panel with live MongoDB document | Panel uses `GET /api/v1/system/raw/:collection/:id`; encrypted fields show as `Binary('...')` |
| P7.6 | When debug ON: action buttons have `[ℹ]` icon opening an info panel | Info panel shows: BIAN Action Term, HTTP endpoint, MongoDB operation, PCI DSS control |
| P7.7 | When debug ON: forms show "Load test data" dropdown | Dropdown has 2–3 realistic presets; selecting one fills all form fields |

#### FR-v4-P8: Enhanced Login UX (Ch-05)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P8.1 | When debug OFF: standard login form (username + password) | Functional login with all demo credentials |
| P8.2 | When debug ON: login page shows all 7 demo users as clickable cards | Cards replace the form; each shows name, role badge, department |
| P8.3 | Role badge colors: customer=blue, analyst=amber, investigator=orange, auditor=red, merchant_officer=purple | Color consistent across all pages that reference roles |
| P8.4 | Clicking a user card logs in immediately (no password required in debug mode) | JWT issued; user redirected to role-appropriate home page |
| P8.5 | In debug mode: each login card shows `partyInstanceReference` and `customerAuthenticationInstanceReference` | BIAN SD-13 and SD-91 references visible on card |

---

### NFR-v4: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v4-01 | Backward compatibility | Structural refactor does not change any API URL, request schema, or response shape | All v3 integration tests pass unchanged after refactor |
| NFR-v4-02 | PCI CDE scope | Modules `customer`, `transactions`, `gateway` are explicitly documented as in-scope; `fraud`, `identity` as adjacent; `system` as non-CDE | EP §3.8.1 BIAN Module Map confirms scope classification; no CHD in `fraud` or `system` module responses |
| NFR-v4-03 | Security | `merchantApiKeyHash` is never returned in any GET response | Integration test: `GET /merchants/:id` response parsed for absence of `merchantApiKeyHash` field |
| NFR-v4-04 | Idempotency | Duplicate `X-Idempotency-Key` on any gateway write endpoint returns 409 within P95 < 100ms | Load test with duplicate key; verify consistent 409 response |
| NFR-v4-05 | Demo explainability | A non-technical AE can narrate the gateway flow (merchant → intent → authorization → fraud case) in ≤ 2 minutes | Validated by IST team walkthrough |
| NFR-v4-06 | Module isolation | No module imports from another module's `controllers/` or `models/` directory directly | `grep -r "from '../../[^s]" backend/src/modules` returns zero cross-module direct imports (only `shared/` and `vendors/` allowed) |
| NFR-v4-07 | Debug Mode safety | `DebugRawDoc` component is only rendered when `DEMO_DEBUG_ENABLED=true`; never in production | Build time check: component import guarded by env var; E2E test confirms panel absent when env var unset |
| NFR-v4-08 | Onboarding realism | Merchant application flow (submit → review → approve) completes without manual DB edits | Full end-to-end test: customer submits, officer approves, merchant portal shows `agreed` status |
| NFR-v4-09 | Seed completeness | `npm run db:seed` populates all 7 demo users and 3 merchants without error on a clean Atlas cluster | CI: seed runs against a test cluster and all collections have expected document counts |

---

## v5: Agentic Fraud Investigation

### Objective

Introduce AI agent integration into the fraud investigation workflow. The primary target is the MongoDB Agentic Platform (Magenta preferred), but the architecture is designed so that any external agentic system — such as Agentic ThreatSight360 (fsi/fsi-aml-fraud-detection) — can integrate through the same REST (Representational State Transfer) API surface using a `level2_investigator` service credential.

The agent automatically pre-reviews each fraud case when it opens, queries the encrypted QE collections to gather context, produces a structured draft diagnosis, and presents it to the L1 analyst as a suggested action. The human analyst confirms, overrides, or escalates. This demonstrates how agentic AI integrates with existing encrypted data workflows without relaxing security controls.

As with v3 and v4, external agent adoption (e.g. Agentic ThreatSight360 performing its own integration work) is fully decoupled: v5 is complete when the PSP platform publishes the agent-accessible API contracts and the Magenta-based agent works end-to-end, regardless of whether any third-party agent has integrated.

### Definition of Done

- [ ] All v1, v2, v3, and v4 DoD criteria still pass
- [ ] AI agent fires automatically when a `fraudDiagnosisCase` is created
- [ ] Agent queries `customerAgreementProcedure` and `cardTransactionLog` via existing QE equality endpoints
- [ ] Agent produces a structured draft: risk summary, recommended action (`clear` / `escalate` / `investigate`), confidence score 0–100
- [ ] L1 analyst sees the AI draft inline in the case detail view; can confirm, override, or dismiss
- [ ] Agent action is logged in `diagnosisActionLog` with `performedByRole: 'ai_agent'`
- [ ] L2 investigator sees the agent's context note alongside sensitive field reveal

---

### FR-v5: Functional Requirements

#### FR-v5-30: AI Agent Pre-Review (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 30.1 | Agent is triggered automatically when a fraud case status transitions to `open` | Agent invocation logged within 2 seconds of case creation |
| 30.2 | Agent queries `customerAgreementProcedure` by `cardTransactionAccountReference` to retrieve customer profile | Agent uses existing QE equality search endpoint: `GET /api/v1/customer?accountRef=<value>` |
| 30.3 | Agent queries `cardTransactionLog` for prior transactions by same card token | Agent uses `GET /api/v1/transactions?cardToken=<value>` |
| 30.4 | Agent produces a structured JSON draft: `{ riskSummary, recommendedAction, confidenceScore, supportingEvidence[] }` | All four fields are present in the agent output |
| 30.5 | Agent action is appended to `diagnosisActionLog` with `performedByRole: 'ai_agent'` | Log entry present in MongoDB document after agent completes |

#### FR-v5-31: AI Draft UI (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 31.1 | L1 case detail view shows "AI Pre-Review" panel when a draft is available | Panel appears inline, above the analyst action buttons |
| 31.2 | Panel displays: risk summary, recommended action badge, confidence percentage, supporting evidence list | All five elements are visible |
| 31.3 | L1 analyst can click "Accept Recommendation", "Override", or "Dismiss AI draft" | Each action updates case status and logs the event |
| 31.4 | L2 investigator case detail shows the AI context note alongside sensitive fields | AI summary visible in L2 view |
| 31.5 | Audit trail includes agent events with `performedByRole: 'ai_agent'` and action type `ai_review` | Events appear in the audit timeline |

#### FR-v5-32: Agent Infrastructure (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 32.1 | Agent is implemented as a Magenta tool-calling agent or equivalent Agentic SDK | Agent invokes existing API endpoints as tools: no direct DB access |
| 32.2 | Agent output is stored in `fraudDiagnosisCase.agentDraftDiagnosis` field | Field is populated after agent completes; readable without QE decryption |
| 32.3 | Agent API key and configuration are in `.env`; no credentials in source code | `MAGENTA_API_KEY` or equivalent env var used |

---

### NFR-v5: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v5-01 | Performance | Agent pre-review completes within acceptable latency for demo | Agent draft available within 5 seconds of case creation |
| NFR-v5-02 | Security | Agent uses only existing API endpoints: no direct MongoDB connection, no key access | Agent cannot bypass QE or RBAC layer |
| NFR-v5-03 | Explainability | Non-technical audience can understand what the agent did and why | Agent evidence list uses plain English; no raw JSON shown in UI |
| NFR-v5-04 | Backward compatibility | v1–v4 flows work unchanged when agent is disabled (`AGENT_ENABLED=false`) | Full payment-to-investigation flow completes with `AGENT_ENABLED=false` |

---

## v6 — Integration Hub & Compliance Orchestration

**Goal:** Connect the demo to external compliance systems using BIAN SD-193 External Provider Arrangements. Every compliance function ships with an internal default provider that works out-of-the-box. External providers (Refinitiv, FICO, Onfido, NICE Actimize, etc.) can be registered at runtime and override the internal defaults. This transforms the demo from an isolated proof-of-concept to an integration-ready reference architecture.

**Key deliverables:** `integrationRegistry` collection (SD-193), integration dispatch service, inbound callback + HMAC validation, `system_admin` business role, `/system/admin` management portal.

**BIAN Service Domains:** SD-193 (External Provider Arrangements) + all existing SDs for internal defaults (SD-63, SD-13, SD-53, SD-89, SD-99, SD-83)

**PCI DSS:** Req 12.8 (third-party service provider list and agreements), Req 10.2.1 (audit log of provider access), Req 10.7 (log retention 90 days), Req 6.3.3 (credential protection), Req 7.1 (Separation of Duties — system_admin vs devops admin)

**Pre-requisites:** v5 (AI Agent fraud investigation) complete.

---

### v6 Functional Requirements

| ID | Feature | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-v6-01 | Integration Registry — CRUD | system_admin can register, view, update, and list integration providers via `/api/v1/integrations`. Non-system_admin roles receive 403. | Critical |
| FR-v6-02 | Integration Registry — API key management | POST /integrations returns plaintext key exactly once. Subsequent GET never exposes the key — only a visible prefix (e.g. `fds_live_...`). POST /rotate-key invalidates old key and returns new key once. | Critical |
| FR-v6-03 | Internal-First dispatch | For each integration type, the dispatch service uses the internal handler when no active external provider is registered. The system never returns errors due to absent external configuration. | Critical |
| FR-v6-04 | External provider dispatch (sync) | When an active external provider is registered for `fraud_detection` or `hrp_sanctions`, the dispatch service calls the provider's endpoint, parses the response, and updates the relevant record. Timeout and retry policy are respected. | High |
| FR-v6-05 | External provider dispatch (async + callback) | When an active external provider is registered for `kyc_identity`, `kyb_business`, or `aml_monitoring` in async mode, the dispatch service sends a request and waits for a callback on `/webhooks/{type}/{id}/callback`. | High |
| FR-v6-06 | Inbound callback — HMAC validation | Every POST to `/webhooks/*` validates the `X-Webhook-Signature: sha256=<hmac>` header. Requests without a valid signature return 401. | Critical |
| FR-v6-07 | Integration Event audit log | Every dispatch, callback, health check, and test fires an `IntegrationEvent` record. The record includes timestamp, event type, arrangement reference, status, latency, and a SHA-256 hash of the payload (not the payload itself). | Critical |
| FR-v6-08 | Provider health check + test | POST /integrations/:id/test fires a synthetic event to the configured endpoint and returns `{ status, latencyMs }`. The `externalProviderHealthStatus` field is updated after every test. | High |
| FR-v6-09 | Suspend integration | POST /integrations/:id/suspend sets status to `suspended`. Internal providers (externalProviderIsInternal: true) return 400 — cannot be suspended. | High |
| FR-v6-10 | system_admin role | A new `system_admin` role can log in via `/system`. After login, the user is redirected to `/system/admin`. The role has no access to fraud investigation or merchant approval workflows. | Critical |
| FR-v6-11 | Admin portal — integration dashboard | `/system/admin` shows 6 integration type tiles (one per type), each with the active provider name, health status indicator, and last check time. Internal providers show a "Built-in" badge. | High |
| FR-v6-12 | Admin portal — integration list | `/system/admin/integrations` lists all providers with name, type, status, mode (sync/async), health, and last event timestamp. | High |
| FR-v6-13 | Admin portal — integration detail + test | `/system/admin/integrations/[id]` shows full provider config (no key hash visible), event log (last 20), and a "Test connection" button. After test, latency and status are displayed. | High |
| FR-v6-14 | Admin portal — register new integration | `/system/admin/integrations/new` wizard: select type → enter name/endpoint/auth scheme → paste API key → select trigger events → submit. API key is shown in a one-time reveal panel after creation. | High |
| FR-v6-15 | Admin portal — token lifecycle | `/system/admin/tokens` lists API tokens by prefix, creation date, and last-used date. "Rotate key" and "Suspend" actions available. | Medium |
| FR-v6-16 | Pre-seeded internal providers | On first seed, 3 internal providers are created: FDS (fraud_detection), HRPC (hrp_sanctions), AML (aml_monitoring). All have `externalProviderIsInternal: true` and `externalProviderArrangementStatus: active`. | Critical |

---

### v6 Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v6-01 | Security | API key never stored in plaintext | bcrypt hash only in DB; plaintext returned at creation/rotation ONCE, not retrievable after |
| NFR-v6-02 | Security | Inbound callbacks authenticated | Every POST to /webhooks/* rejected without valid HMAC-SHA256 `X-Webhook-Signature` |
| NFR-v6-03 | Security | Separation of Duties | `system_admin` role has zero access to: server exec, env vars, service restart (devops admin) |
| NFR-v6-04 | Reliability | Internal-First guarantee | System operates with zero external providers configured: all 3 internal providers active from seed |
| NFR-v6-05 | Performance | Dispatch adds <5ms on internal path | Internal dispatch (no HTTP call) completes within 5ms on the fraud scoring hot path |
| NFR-v6-06 | Observability | Every provider interaction logged | IntegrationEvent record created for every dispatch, callback, health check, test |
| NFR-v6-07 | Compliance | Event log retention ≥ 90 days | TTL index on integrationEvents: expireAfterSeconds: 7776000 (PCI DSS Req 10.7) |
| NFR-v6-08 | Compliance | Provider list maintained | All registered providers (internal + external) visible in registry (PCI DSS Req 12.8.1) |
| NFR-v6-09 | Backward compat | v1–v5 flows unchanged | All existing fraud investigation, KYC/KYB, merchant onboarding flows work with internal providers active |
| NFR-v6-10 | Type safety | No `any` types | `npm run build` exits 0 on backend + frontend |

---

### v6 BIAN Service Domain Coverage

| BIAN SD | Role in v6 | New or Existing |
|---|---|---|
| SD-193 External Provider Arrangements | `integrationRegistry` collection — the Integration Hub registry | **New** |
| SD-63 Fraud Evaluation | Internal FDS default provider | Existing (SD-63 already implemented) |
| SD-13 Party Reference Data | Internal HRPC sanctions default | Existing (HRPC endpoint already implemented) |
| SD-53 Customer Agreement | Internal KYC identity default (BQ:Step) | Existing (KYC BQ:Step already implemented) |
| SD-89 Merchant Relations | Internal KYB business default (BQ:Step) | Existing (KYB BQ:Step already implemented) |
| SD-99 Suspicious Activity Analysis | Internal AML monitoring stub | New stub (simple pattern matching) |
| SD-83 Customer Credit Rating | Internal credit bureau default | Existing (customerCreditRatingState already seeded) |

---

### v6 New Collections

| Collection | BIAN SD | Control Record Type | QE | Index strategy |
|---|---|---|---|---|
| `integrationRegistry` | SD-193 | ExternalProviderArrangement | No | type+endpoint unique; type+status; isInternal |
| `integrationEvents` | SD-193 | ExternalProviderArrangementActionLog | No | arrangementRef + recordCreatedDateTime; TTL 90d |

---

### v6 Definition of Done

- [ ] `npm run build` exits 0 (backend + frontend)
- [ ] `npm run seed` completes without errors; 3 internal providers visible in `integrationRegistry`
- [ ] `POST /api/v1/integrations` (system_admin token): returns 201 with plaintext `apiKey`
- [ ] Subsequent `GET /api/v1/integrations/:id`: no `apiKey` or `externalProviderApiKeyHash` in response
- [ ] `POST /webhooks/fds/:id/callback` without signature: returns 401
- [ ] `POST /webhooks/fds/:id/callback` with valid HMAC: returns 200 and updates fraud case
- [ ] `POST /api/v1/integrations/:id/suspend` on internal provider: returns 400
- [ ] `system_admin` login at `/system`: redirected to `/system/admin`
- [ ] Non-system_admin login: `/system/admin` redirects to `/system`
- [ ] Integration dashboard shows 3 internal providers with "Built-in" badges
- [ ] `POST /api/v1/integrations/:id/test` returns `{ status: 'ok', latencyMs: <n> }` for a reachable endpoint
- [ ] Integration event log records: at least one event per dispatch + callback
- [ ] TTL index on `integrationEvents` set to 7776000 seconds
- [ ] All FR-v6-01 to FR-v6-16 acceptance criteria pass
- [ ] All NFR-v6-01 to NFR-v6-10 measures pass
- [ ] Phase 7 test suite (unit + integration + E2E) passes with 0 failures
- [ ] `docs/technical-spec.md` §1, §5, §6 updated with new models, indexes, and API contracts before first commit

---

## v7 — Event-Driven Business Process Audit (2026-06-13)

**Theme:** Replace the fragmented integration log with a unified, timeseries-backed business process audit layer — traceable, append-only, and fully BIAN + PCI DSS aligned.

**ADR:** ADR-025 (Business Process Event Log: timeseries audit layer + real endpoint dispatch)

**Stack changes:** Two new MongoDB timeseries collections; typed payload contracts per integration category; endpoint-first dispatch; stub internal endpoints; full-stack event timeline UI.

---

### v7 Functional Requirements

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-v7-01 | Every business process emits a structured audit event | `POST /api/v1/transactions` writes ≥1 doc to `businessProcessEvent` (verified via MCP); `POST /api/v1/kyc` writes ≥1 doc to `complianceProcessEvent` |
| FR-v7-02 | Integration events carry `businessContext` correlation | `integrationEvents` documents include `businessContext.entityType`, `entityId`, `processType` after any dispatch |
| FR-v7-03 | Internal providers with endpoint make real HTTP calls | `POST /api/v1/transactions` with FDS provider configured at `http://localhost:3001/api/v1/internal/fds/score` results in a real loopback HTTP call visible in `integrationEvents` with `integrationEventResponseCode: 200` |
| FR-v7-04 | Stub internal endpoints are accessible and typed | `POST /api/v1/internal/fds/score` with `X-Integration-Source: internal` returns `{ riskScore, fraudFlag, recommendation }` |
| FR-v7-05 | `businessProcessEvent` TTL is 90 days | MongoDB timeseries `expireAfterSeconds: 7776000` set on collection |
| FR-v7-06 | `complianceProcessEvent` TTL is 365 days | MongoDB timeseries `expireAfterSeconds: 31536000` set on collection |
| FR-v7-07 | Process events queryable by entity | `GET /api/v1/events/process/:entityType/:entityId` returns events for a given entity (e.g. `transaction/txn-001`) with `security_auditor` token |
| FR-v7-08 | Cross-entity process event list for admin/auditor | `GET /api/v1/events/process?processType=payment_processing&limit=20` returns paginated results |
| FR-v7-09 | Compliance event list for auditor | `GET /api/v1/events/compliance?processType=kyc_verification` returns paginated results with `security_auditor` token |
| FR-v7-10 | Admin event timeline UI | `/system/admin/events` page renders last 50 process events with entity links, process type filter, and status badges |
| FR-v7-11 | Demo audit page shows process + compliance tabs | `/demo/audit` has two new tabs: "Process Events" and "Compliance Events" with sortable event lists |
| FR-v7-12 | `merchantAgreementEvents` formally created | `createCollections.ts` explicitly creates the collection; `npm run setup` shows `merchantAgreementEvents` in collection list |
| FR-v7-13 | `integrationEvents` migrated to timeseries | `integrationEvents` is a timeseries collection with `timeField: recordCreatedDateTime`, no unique secondary index, no manual TTL index |
| FR-v7-14 | CHD never appears in event summaries | `eventSummary` field in any process event does not contain PAN, CVV, expiryDate, cardholderName, trackData (validated by unit test) |
| FR-v7-15 | Typed payload contracts per integration category | TypeScript compilation passes with `FdsOutboundPayload`, `KycInboundPayload`, etc. — all 18 interfaces compile without `any` |

---

### v7 Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v7-01 | Performance | Fire-and-forget event emission does not block request path | p95 latency of `POST /api/v1/transactions` unchanged (±10 ms) after adding event emission |
| NFR-v7-02 | Audit integrity | Process events are append-only | `updateOne` on `businessProcessEvent` throws `MongoServerError` |
| NFR-v7-03 | PCI DSS Req 10.3 | Timeseries collections satisfy append-only requirement | Collection type verified via `db.getCollectionInfos()` |
| NFR-v7-04 | PCI DSS Req 10.7 | TTL retention enforced at the MongoDB layer | `expireAfterSeconds` set on both timeseries collections |
| NFR-v7-05 | Security | Internal stub endpoints are not JWT-authenticated | `POST /api/v1/internal/fds/score` without `X-Integration-Source` header returns 401 |
| NFR-v7-06 | RBAC | Process event endpoints enforce role scoping | `merchant_officer` token on `GET /api/v1/events/process` returns 403 |
| NFR-v7-07 | Type safety | All new interfaces compile without `any` | `npm run build` exits 0 |
| NFR-v7-08 | Backward compatibility | Existing v6 integration endpoints unchanged | All v6 E2E tests pass after v7 changes |

---

### v7 New Collections

| Collection | Type | BIAN SD | TTL | timeField | metaField |
|---|---|---|---|---|---|
| `businessProcessEvent` | Timeseries | SD-83/SD-63/SD-254/SD-64/SD-99 | 90 days | `eventDateTime` | `processType` |
| `complianceProcessEvent` | Timeseries | SD-16/SD-89/SD-13 | 365 days | `eventDateTime` | `processType` |
| `integrationEvents` (migrated) | Timeseries | SD-193 | 90 days | `recordCreatedDateTime` | `externalProviderArrangementInstanceReference` |

---

### v7 Definition of Done

- [ ] `npm run build` exits 0 (backend + frontend)
- [ ] `npm run setup` completes; `businessProcessEvent`, `complianceProcessEvent`, `merchantAgreementEvents` present in DB
- [ ] `integrationEvents` collection type is `timeseries` (verify via `db.getCollectionInfos()`)
- [ ] `POST /api/v1/transactions` (merchant token): `businessProcessEvent` contains ≥1 doc with `businessContext.entityType: 'transaction'`
- [ ] `POST /api/v1/kyc` (customer token): `complianceProcessEvent` contains ≥1 doc with `processType: 'kyc_verification'`
- [ ] `POST /api/v1/internal/fds/score` with `X-Integration-Source: internal`: returns `{ riskScore, fraudFlag, recommendation }`
- [ ] `POST /api/v1/internal/fds/score` without `X-Integration-Source`: returns 401
- [ ] `GET /api/v1/events/process` with `security_auditor` token: returns paginated results
- [ ] `GET /api/v1/events/process` with `merchant_officer` token: returns 403
- [ ] `GET /api/v1/events/process/:entityType/:entityId` returns events for a known entity
- [ ] `GET /api/v1/events/compliance` with `security_auditor` token: returns paginated results
- [ ] No CHD field in any `eventSummary` in `businessProcessEvent` or `complianceProcessEvent`
- [ ] `/system/admin/events` page renders without error; shows last 50 events
- [ ] `/demo/audit` page renders with "Process Events" and "Compliance Events" tabs
- [ ] FDS integration dispatch (internal provider with localhost endpoint): `integrationEvents` record has `integrationEventResponseCode: 200` and `businessContext` populated
- [ ] All FR-v7-01 to FR-v7-15 acceptance criteria pass
- [ ] All NFR-v7-01 to NFR-v7-08 measures pass
- [ ] `docs/technical-spec.md` §1, §5, §6 updated with new models, indexes, and API contracts before first commit

---

## Cross-iteration NFRs

These requirements apply to all versions from v1 onward:

| ID | Category | Requirement |
|---|---|---|
| NFR-X-01 | Data safety | Synthetic data only: no real PAN, CVV, PIN, government ID, or address |
| NFR-X-02 | PCI compliance | SAD (CVV, PIN, magnetic stripe) is never stored in any collection at any version |
| NFR-X-03 | Security | `.env` file is excluded from git; no secrets in source code or committed files |
| NFR-X-04 | Accessibility | LeafyGreen components used: WCAG 2.1 AA compliance inherited from the design system |
| NFR-X-05 | Documentation | Every new API endpoint added at any version is documented in technical-spec.md before merging |
| NFR-X-06 | Type safety | `npm run build` exits 0 at every version: no TypeScript `any` escape hatches in production code |
| NFR-X-07 | Agent security | AI agents (v5) use only the public API layer: no direct MongoDB credentials or DEK access |
