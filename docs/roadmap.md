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

All collection names, type suffixes, and `bianServiceDomain` values were brought into strict BIAN compliance as a pre-v1 alignment pass. This is not a new iteration: it is a baseline correction that all iterations (v1–v5) inherit.

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
- [ ] `docker compose up` starts both services and the demo is accessible at `http://localhost:8080`
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
| 05A.2 | `GET /api/v1/system/users` returns list of demo users (name, email, role) without passwords | Response used by frontend user selector dropdown |
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

#### FR-v3-20b: SD-88 Self-Service Card Management (as implemented)

Card-on-file management is its own section (`/system/cards` list + `/system/cards/[cardId]` detail), **not** part of `/system/profile`. This subsection records the API contract as implemented (BIAN SD-88, customer-only, ownership + audit enforced server-side), which supersedes the earlier assumption that a card was revoked via `PATCH {paymentCardStatus:'revoked'}` and that `paymentCardIsPreferred` was toggled via `PATCH` on an existing card.

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 20b.1 | List saved cards | `GET /api/v1/customer/:customerId/cards` returns the customer's cards (masked PAN + status); rendered by `SavedCardsPanel` at `/system/cards` |
| 20b.2 | Add a card, optionally marking it preferred | `POST /api/v1/customer/:customerId/cards` with `paymentCardIsPreferred?: boolean`. **Preferred is set only at add time** (checkbox on `/system/cards/new`); there is no toggle-preferred action on an existing card |
| 20b.3 | View card detail | `GET /api/v1/customer/:customerId/cards/:cardId` (surrogate token, expiry QE:none, alias/note) |
| 20b.4 | Edit alias/note only | `PATCH /api/v1/customer/:customerId/cards/:cardId`, alias/note are the only mutable attributes |
| 20b.5 | Deactivate / reactivate a card | `PATCH /api/v1/customer/:customerId/cards/:cardId/status { active: boolean }`; a deactivated card is declined by the PSP on every operation regardless of issuer decision |
| 20b.6 | Remove a card (soft-delete, replaces the old revoke-via-status) | `DELETE /api/v1/customer/:customerId/cards/:cardId`; confirmation dialog required; emits a compliance audit event server-side (PCI DSS Req 10) |

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

#### FR-v4-P5: Frontend, Merchant Context

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P5.1 | Simulator Mode: step 0 "Merchant creates payment intent" is inserted before the checkout step | Step visible; shows merchant card (name, MCC, risk category) and the generated payment order reference |
| P5.2 | Fraud case detail (Simulator + Application Mode): "Merchant Profile" panel shows merchant name, MCC description, risk category, average transaction amount, and amount ratio | Panel visible; ratio calculated as `transactionAmount / merchantAverageTransactionAmount`; label "78x merchant average" when ratio ≥ 10 |
| P5.3 | Application Mode: route `/system/merchant` accessible to users with role `customer` | Route loads without errors; shows merchant's payment links, checkout sessions, and profile |

#### FR-v4-P6: Merchant Onboarding Lifecycle (Ch-05)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P6.1 | Customer can submit a merchant application via `POST /api/v1/merchants`: application starts at `under_review` | Atlas document has `merchantAgreementStatus: 'under_review'`; `merchantOwnerPartyReference` FK populated from JWT |
| P6.2 | `merchant_officer` role can list all pending applications via `GET /api/v1/merchants?status=under_review` | Officer dashboard shows applications with merchant name, category, owner, submitted date |
| P6.3 | `merchant_officer` can approve an application via `PATCH /api/v1/merchants/:id/review`, body `{ action: 'approve', reviewNote: '...' }` | Status transitions to `agreed`; `merchantReviewedByPartyReference`, `merchantReviewedDateTime`, `merchantReviewNote` populated |
| P6.4 | `merchant_officer` can reject an application via `PATCH /api/v1/merchants/:id/review`, body `{ action: 'reject', reviewNote: '...' }` | Status transitions to `rejected`; review metadata populated |
| P6.5 | Webhook event `merchant.agreement.activated` is emitted when a merchant is approved | Event payload includes `merchantAgreementInstanceReference`, `merchantName`, `reviewedByPartyReference` |
| P6.6 | Frontend: `/system/merchant` shows "Request Merchant Account" form when authenticated customer has no linked merchant | Form includes all required BIAN fields; "Load test data" dropdown with 3 presets |
| P6.7 | Frontend: after submission, merchant portal shows "Application under review" state with application details | Status badge displayed; timestamp shown |
| P6.8 | Frontend: `/system/merchant/review` route accessible to `merchant_officer`, shows pending applications queue | Each card has Approve / Reject buttons; review notes input field |
| P6.9 | Seed data: `backend/data/merchants.json` contains 3 records, 1 `active`, 1 `under_review`, 1 `active` (different owner) | `npm run db:seed` inserts all 3 without error |

#### FR-v4-P7: Debug Mode (Ch-05)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| P7.1 | `[⚡ Debug]` button visible in top nav bar when `DEMO_DEBUG_ENABLED=true` env var is set | Button absent when env var is absent or false |
| P7.2 | Toggle persists across navigation via `localStorage` key `demo_debug_mode` | Reload browser tab: debug state unchanged |
| P7.3 | When debug ON: every entity card shows a BIAN Service Domain chip (e.g., `SD-89 · Merchant Relations`) | Chip visible on merchant cards, transaction cards, case cards |
| P7.4 | When debug ON: every encrypted field shows a lock icon with QE mode tooltip | Tooltip text: `"QE:equality, BSON Binary subtype 6 · PCI DSS Req 3.5.1"` |
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

Introduce AI agent integration into the fraud investigation workflow. The primary target is the MongoDB Agentic Platform (Magenta preferred), but the architecture is designed so that any external agentic system: such as Agentic ThreatSight360 (fsi/fsi-aml-fraud-detection), can integrate through the same REST (Representational State Transfer) API surface using a `level2_investigator` service credential.

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

## v6: Integration Hub & Compliance Orchestration

**Goal:** Connect the demo to external compliance systems using BIAN SD-193 External Provider Arrangements. Every compliance function ships with an internal default provider that works out-of-the-box. External providers (Refinitiv, FICO, Onfido, NICE Actimize, etc.) can be registered at runtime and override the internal defaults. This transforms the demo from an isolated proof-of-concept to an integration-ready reference architecture.

**Key deliverables:** `integrationRegistry` collection (SD-193), integration dispatch service, inbound callback + HMAC validation, `system_admin` business role, `/system/admin` management portal.

**BIAN Service Domains:** SD-193 (External Provider Arrangements) + all existing SDs for internal defaults (SD-63, SD-13, SD-53, SD-89, SD-99, SD-83)

**PCI DSS:** Req 12.8 (third-party service provider list and agreements), Req 10.2.1 (audit log of provider access), Req 10.7 (log retention 90 days), Req 6.3.3 (credential protection), Req 7.1 (Separation of Duties, system_admin vs devops admin)

**Pre-requisites:** v5 (AI Agent fraud investigation) complete.

---

### v6 Functional Requirements

| ID | Feature | Acceptance Criteria | Priority |
|---|---|---|---|
| FR-v6-01 | Integration Registry: CRUD | system_admin can register, view, update, and list integration providers via `/api/v1/integrations`. Non-system_admin roles receive 403. | Critical |
| FR-v6-02 | Integration Registry: API key management | POST /integrations returns plaintext key exactly once. Subsequent GET never exposes the key, only a visible prefix (e.g. `fds_live_...`). POST /rotate-key invalidates old key and returns new key once. | Critical |
| FR-v6-03 | Internal-First dispatch | For each integration type, the dispatch service uses the internal handler when no active external provider is registered. The system never returns errors due to absent external configuration. | Critical |
| FR-v6-04 | External provider dispatch (sync) | When an active external provider is registered for `fraud_detection` or `hrp_sanctions`, the dispatch service calls the provider's endpoint, parses the response, and updates the relevant record. Timeout and retry policy are respected. | High |
| FR-v6-05 | External provider dispatch (async + callback) | When an active external provider is registered for `kyc_identity`, `kyb_business`, or `aml_monitoring` in async mode, the dispatch service sends a request and waits for a callback on `/webhooks/{type}/{id}/callback`. | High |
| FR-v6-06 | Inbound callback: HMAC validation | Every POST to `/webhooks/*` validates the `X-Webhook-Signature: sha256=<hmac>` header. Requests without a valid signature return 401. | Critical |
| FR-v6-07 | Integration Event audit log | Every dispatch, callback, health check, and test fires an `IntegrationEvent` record. The record includes timestamp, event type, arrangement reference, status, latency, and a SHA-256 hash of the payload (not the payload itself). | Critical |
| FR-v6-08 | Provider health check + test | POST /integrations/:id/test fires a synthetic event to the configured endpoint and returns `{ status, latencyMs }`. The `externalProviderHealthStatus` field is updated after every test. | High |
| FR-v6-09 | Suspend integration | POST /integrations/:id/suspend sets status to `suspended`. Internal providers (externalProviderIsInternal: true) return 400, cannot be suspended. | High |
| FR-v6-10 | system_admin role | A new `system_admin` role can log in via `/system`. After login, the user is redirected to `/system/admin`. The role has no access to fraud investigation or merchant approval workflows. | Critical |
| FR-v6-11 | Admin portal: integration dashboard | `/system/admin` shows 6 integration type tiles (one per type), each with the active provider name, health status indicator, and last check time. Internal providers show a "Built-in" badge. | High |
| FR-v6-12 | Admin portal: integration list | `/system/admin/integrations` lists all providers with name, type, status, mode (sync/async), health, and last event timestamp. | High |
| FR-v6-13 | Admin portal: integration detail + test | `/system/admin/integrations/[id]` shows full provider config (no key hash visible), event log (last 20), and a "Test connection" button. After test, latency and status are displayed. | High |
| FR-v6-14 | Admin portal: register new integration | `/system/admin/integrations/new` wizard: select type → enter name/endpoint/auth scheme → paste API key → select trigger events → submit. API key is shown in a one-time reveal panel after creation. | High |
| FR-v6-15 | Admin portal: token lifecycle | `/system/admin/tokens` lists API tokens by prefix, creation date, and last-used date. "Rotate key" and "Suspend" actions available. | Medium |
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
| SD-193 External Provider Arrangements | `integrationRegistry` collection: the Integration Hub registry | **New** |
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

## v17: Bank-Movement Cycle Precision (Funds-Availability Gate + FX)

### Objective
Close the money-movement cycle so it is precise with no balance discrepancy at origin or destination (users or merchants): card authorization must verify real funding-account balance from the DB, decline on insufficient funds per BIAN, and keep balances consistent across the tarjeta → cuenta → ejecución → destino chain. See [engineering-proposal.md ADR-038](engineering-proposal.md).

### FR-v17: Functional Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-v17-01 | Funds-availability gate | A PSP-funded card payment adds a 4th parallel gate `funds` (SD-36 AIS). Sufficient funds → hold + approve; insufficient → `declined` + responseCode `'51'` + `decisionReason 'insufficient_funds'`. |
| FR-v17-02 | Atomic hold, no race | The hold is a `$gte`-conditional `$inc` (available → pending); it is the authoritative decision (no read-modify-write). |
| FR-v17-03 | Compensation on decline | If any gate declines after the funds gate held, the hold is released (pending → available), idempotently, incl. the decline-before-hold ordering race. |
| FR-v17-04 | Provider-indifference | The balance read uses the `account_information` capability via dispatch; built-in module and external PSD2 AIS are interchangeable with no flow change. No internal/external account branching. |
| FR-v17-05 | Scope | Only cards with a `fundingPayoutAccountInstanceReference` are gated; new/external tokens pass through (issuer governs their funds). |
| FR-v17-06 | Currency exchange | Amounts are converted into the account currency (mid rate + spread) before any balance mutation (card hold/settle, merchant debit/credit, P2P credit, refund). New capability `currency_exchange`, replaceable. |
| FR-v17-07 | P2P atomicity | P2P debit respects the conditional `$gte`; if the recipient credit fails, the sender debit is reverted. Cross-currency credit is FX-converted to the recipient account currency. |
| FR-v17-08 | Seed reconciliation | Seeders default to EUR; `pending/reserved` start at 0; `balanceCreditLog.initial_deposit == total balance`. No account starts negative. |

### Definition of Done: v17
- [ ] No card payment can be `authorized` without sufficient funds (in account currency, post-FX).
- [ ] Every hold is released on decline; settlement clears the hold exactly once; no orphan holds or double debits.
- [ ] No balance goes negative at origin or destination (user or merchant) in any intermediate state.
- [ ] Σ movements (SD-66 ledger) == Δ balance per account.
- [ ] Unit tests green (funds gate compensation, FX, checkFunds); `npm run build` exits 0.
- [ ] (Pending infra) integration + E2E green.

## v18: Merchant SSO App + Commission & Activity Attribution

> Delivered under **development plan v18** (`tmp/dev.v17.plan.md` lineage). "v18" is a development-plan
> iteration, not a product release version (product themes are v1–v5). FR ids below carry the `v18` tag
> for traceability only.

### Objective
Give merchants an external, SSO-authenticated experience: sign in with their PSP identity, view the PSP
activity attributed to them, and configure their commission: without forking the PSP data model or
crossing the CHD boundary. See [engineering-proposal.md ADR-041](engineering-proposal.md).

### FR-v18: Functional Requirements

| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| FR-v18-01 | Merchant SSO app | Standalone Next.js app `merchant/` (no DB, no Fastify) authenticates via OAuth2/OIDC SSO as a confidential client and reads PSP data via the PSP API only; local port `8082` / container `8080`; env prefix `PSP_MERCHANT_` | ✅ |
| FR-v18-02 | Commission model | Numeric fee reuses `paymentExecutionProcedure.feeAmount` (SD-65) + attribution sub-doc `fee {feeMerchantReference, feeRateApplied, feeCollectedDateTime}`; rate `merchantCommissionRate` on SD-89, editable in merchant settings and audited; `commissionRevenue` derived. No new collection | ✅ |
| FR-v18-03 | PSP merchant activity view | PSP staff can view activity attributed per merchant, driven by `businessProcessEvent` attribution fields (`clientId`, `merchantAgreementReference`, `actingPartyReference`, `actingChannel`), no new collection | ✅ |
| FR-v18-04 | Cross-merchant authorizations audit | L1 / L2 / auditor can audit authorizations across merchants (per-merchant filter, acting party, channel) | ✅ |
| FR-v18-05 | Authorized Applications | End users see "Authorized Applications" (connected apps) with per-app operations (view / revoke) | ✅ |
| FR-v18-06 | Granular + incremental consent | User selects scopes at consent; unknown scope → `invalid_scope` (RFC 6749); broadening scope forces re-consent; scopes use PSP `verb:resource` convention | ✅ |
| FR-v18-07 | Merchant branding | Merchant app branding driven by OIDC client metadata `logo_uri` / `client_uri` | ✅ |
| FR-v18-08 | Boundary & scopes | Merchant-facing PSP endpoints use `skipAuth` + `validateMerchantToken` + sub-binding; least-privilege scopes; no CHD in merchant app (PCI SAQ A); IBAN masked-only (GDPR/PSD2) | ✅ |

### Definition of Done: v18
- [x] Merchant app runs standalone (no DB/Fastify), SSO login, PSP-API-only integration.
- [x] Commission modelled BIAN-purely (SD-65 fee + attribution sub-doc, SD-89 rate) with no new collection; rate configurable in merchant settings and audited.
- [x] PSP merchant activity view + cross-merchant authorizations audit for L1/L2/auditor via `businessProcessEvent` attribution.
- [x] User "Authorized Applications" with per-app operations; granular + incremental OAuth consent (`invalid_scope`, re-consent on broadening).
- [x] Merchant branding via `logo_uri`; PCI SAQ A held, IBAN masked-only.
- [x] `npm run build` exits 0 (backend + merchant app).
- [ ] Follow-ups: A-06 runtime fee wiring (revenue currently seed-based); API-driven payment OAuth path.

*Added 2026-07-06 (v18).*

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

## Bank Transfers (ACH / SEPA / SWIFT): capability add-on

> Delivered under **development plan v17** (`tmp/dev.v17.plan.md`, tranche "v17.1"). "v17" is a
> development-plan iteration, not a product release version (product themes are v1–v5). FR ids below
> carry the `v17.1` dev-plan tag for traceability only.

| FR | Area | Acceptance criteria | Status |
|---|---|---|---|
| FR-v17.1-01 | Rail engine | Rail auto-derived from country/currency/data with user override; IBAN/BIC/routing validated per ISO 13616 / ISO 9362 / NACHA; per-rail fees and standard return-code maps (ACH R-codes, SEPA reject, SWIFT) | ✅ |
| FR-v17.1-02 | Provider dispatch | All transfers (bank, P2P, merchant payout) and account validation execute via `dispatchProvider` (`payment_initiation` / `account_information`); no direct builtin import; builtin replaceable by external without flow change | ✅ |
| FR-v17.1-03 | API | `POST /gateway/transfers/preview` (rail+fee+validation), `POST /gateway/transfers/bank` (execute, `Idempotency-Key`), `GET /gateway/transfers/:ref/status` (real-time) | ✅ |
| FR-v17.1-04 | Frontend | `/system/transfer/bank`: live rail detection, validation, fee, submit; live status polling; recurring Direct Debit option | ✅ |
| FR-v17.1-05 | Async lifecycle | Transfers are external and async: funds held on submit, credited/cleared on settlement (`bank.transfer.settled`), released on `failed` | ✅ |
| FR-v17.1-06 | Risk gate | Pre-initiation FDS + HRP + AML screening blocks before funds move and opens an L1-reviewable fraud case (status `open`) on a negative evaluation | ✅ |
| FR-v17.1-07 | Recurring mandates | ACH Direct Debit / SEPA SDD mandates: create/list/cancel + background scheduler (`runDueMandates`) reusing the transfer flow | ✅ |
| FR-v17.1-08 | Compliance & audit | Bank coordinates transaction-scoped, never on the bus; business + compliance events correlated by execution reference (PCI DSS Req 10) | ✅ |
| FR-v17.1-09 | Config | Config-driven rail fees (`PAYOUT_FEE_*`), sandbox flag (`PAYOUT_SANDBOX`), scheduler interval (`PAYOUT_MANDATE_SCHEDULER_MS`) | ✅ |
| FR-v17.1-10 | Test data | Wiki `Dataset.md` (users, cards, accounts, approve/block scenarios) + end-user guide `Bank-Transfers.md`, aligned with seeders and validators | ✅ |

**Definition of Done (v17.1):** ✅ rail engine unit-tested; backend + frontend typecheck clean; preview /
execute / status endpoints + idempotency working; async settlement via provider; risk gate + L1 case;
recurring mandates + scheduler; UI enabled; docs + wiki published. ⏳ Remaining (infra-gated): integration
+ E2E (MongoDB + Playwright) and the `ks-core` / `ks-mongodb-ist-demo` compliance-skill gate. Detail in
`tmp/dev.v17.plan.md`.

*Added 2026-07-04 (v17.1).*

## CIBA + Passwordless Enrollment (SD-91/SD-16)

> Delivered under **development plan v24** (`tmp/dev.v24.plan.md`). Development-plan iteration, not a
> product release. FR ids carry the `v24` tag for traceability only. Authentication-only; payment
> authorization via CIBA is deferred pending PSD2 RTS Art.5 dynamic linking.

### Objective
Add OIDC CIBA (Client-Initiated Backchannel Authentication) + WebAuthn-style passwordless credential
enrollment to the existing OAuth 2.0/OIDC server. A third-party client starts authentication of a user
with no browser redirect and no password; the user approves out-of-band by signing a server challenge
with an enrolled device key. Real software authenticator (browser WebCrypto), no mocks. See
[technical-spec.md §12](technical-spec.md#12-v24--ciba--passwordless-enrollment-sd-91sd-16).

### FR-v24: Functional Requirements

| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| FR-v24-01 | Passwordless enrollment | Session-gated register/list/rotate/revoke of asymmetric credentials; public key only stored; signed challenge proves possession; owner-scoped (never another user's) | ✅ |
| FR-v24-02 | CIBA bc-authorize | Client-authenticated `POST /bc-authorize` accepts exactly one hint (`login_hint`/`login_hint_token`/`id_token_hint`); >1 → `invalid_request`; unauthorized client → `unauthorized_client`; returns `auth_req_id`/`expires_in`/`interval` | ✅ |
| FR-v24-03 | Assertion-authenticated approval | `GET :authReqId` returns challenge without a session; approval verifies the signature vs stored public key + owner==hint sub + monotonic signCount; bad/absent signature rejected; no session required (passwordless) | ✅ |
| FR-v24-04 | CIBA token grant | ciba grant on existing `/token`; poll returns `authorization_pending`/`slow_down`/`expired_token`/`access_denied`; approved → tokens via `issueTokens()`; cross-client redemption + replay → `invalid_grant` | ✅ |
| FR-v24-05 | Delivery modes | poll (baseline) + ping + push via low-level `deliverWebhook` (Bearer = client_notification_token); ping/push without token → `invalid_request`; non-HTTPS notification endpoint rejected at registration; demo stub receiver | ✅ |
| FR-v24-06 | Both signing algs | RS256 + ES256 supported (polymorphic verifier; ES256 accepts raw r\|\|s WebCrypto form); discovery advertises both | ✅ |
| FR-v24-07 | Discovery | `/.well-known/openid-configuration` advertises `backchannel_authentication_endpoint`, delivery modes, signing algs, ciba grant | ✅ |
| FR-v24-08 | PSP frontend | "Passwordless credentials" section (enroll/rotate/revoke, browser WebCrypto non-extractable + IndexedDB); Authorized Applications shows a "Passwordless (CIBA)" badge and revokes client authorization | ✅ |
| FR-v24-09 | Setup/seed | `--reset` + reseed reproduces the two collections, indexes, the demo credential and the ciba-enabled client | ✅ |

### Definition of Done: v24
- [x] Enrollment + CIBA endpoints live under flat `/api/v1/auth/` (token endpoint unchanged, new grant branch).
- [x] Public keys only stored (PCI Req.3); anti-replay via one-time auth_req_id + monotonic signCount (Req.8); audit via `emitComplianceEvent` (Req.10); HTTPS notification endpoint for ping/push (Req.4).
- [x] AAL1 stated precisely (real software authenticator + user-presence); AAL2 deferred to platform UV with no contract change; no mock authenticator.
- [x] PSP frontend credentials section + Authorized-Apps CIBA badge; browser key non-extractable in IndexedDB.
- [x] setup/seed updated (collections, indexes, demo credential, ciba client); technical-spec §12 + this roadmap updated in the same change.
- [x] Backend + frontend `tsc --noEmit` clean; signature-verifier unit tests pass (7/7, incl. seed fixture round-trip); CIBA integration tests authored (run with `TEST_MONGODB_URI`).
- [ ] Follow-ups: downstream v25 merchant-app passwordless UX; AAL2 platform UV; CIBA payment authorization + PSD2 dynamic linking.

*Added 2026-07-09 (v24).*

## v27: KYC Field Expansion + Queryable Encryption Search Showcase

> Delivered under **development plan v27** (`tmp/dev.v27.plan.md`). Extends the KYC (CDD) data
> model with structured identity attributes and uses them to demonstrate every QE search type
> (equality, range, substring, prefix, suffix) over encrypted GDPR PII. No card/PAN data is ever
> placed in a searchable QE field. See technical-spec §1/§2.1/§5.

### Objective
Give analysts real searches (range / substring / prefix / suffix / equality) directly against
encrypted fields, with the server never seeing plaintext, while staying aligned with BIAN
(SD-13 / SD-53), PCI DSS, GDPR (Art. 5/32) and PSD2.

### FR-v27: Functional Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-v27-01 | Substring search | `partyName` is `QE:substring` (lookup tier). A "contains" query (case/diacritic-insensitive, min length 3) returns matching parties over encrypted data. |
| FR-v27-02 | Range search (date) | `partyDateOfBirth` stored as BSON Date, `QE:range`. Born-between queries return the expected rows; seed spreads DOB across 1950–2005. |
| FR-v27-03 | Range search (int) | `customerAgreementKycCheckRiskScore` is `QE:range` int 0–100. `> 70` returns high-risk rows; seed spreads scores across the boundary. |
| FR-v27-04 | Range search (expiry) | `customerAgreementGovernmentID.expiryDate` is `QE:range` date. "Expiring in next 90 days" returns rows; seed places some expiries within 90 days. |
| FR-v27-05 | Prefix search | `customerAgreementTaxIDNumber` is `QE:prefix` (min length 2). "Starts with ES" returns rows; seed makes some TINs start with `ES`. |
| FR-v27-06 | Suffix search | `customerAgreementGovernmentID.number` is `QE:suffix` (min length 3). "Ends with 4821" returns rows; seed makes some numbers end in `4821`. |
| FR-v27-07 | Equality (contention) | `partyNationality`, `partyPlaceOfBirth`, `customerAgreementGovernmentID.type`/`.issuingCountry`, `customerAgreementOccupation`, KYC `RiskRating`/`PepStatus`/`SanctionsResult` are `QE:equality` with explicit contention (frequency-analysis guard). Both PEP values present in seed. |
| FR-v27-08 | Tier access control | `QE:none` fields (`customerAgreementSourceOfFunds`, `customerAgreementPurposeOfRelationship`, `...ScreeningProviderRef`) decrypt only for the L2 client; L1 receives Binary (stripped). Searchable fields decrypt for L1 + L2. |
| FR-v27-09 | Auth unaffected | `partyEmailAddress` / `partyMobilePhoneNumber` remain `QE:equality`; login and exact lookup regression-safe. |
| FR-v27-10 | Text-search gating | `PSP_QE_TEXT_SEARCH=false` degrades substring/prefix/suffix to `QE:equality` (contention 8) so setup succeeds on pre-8.2 clusters without losing encryption or lookup-tier access. |
| FR-v27-11 | Seed completeness | `--reset` + reseed leaves no new field unset (rows 1–20 of plan §3). Enrichment is deterministic (stable across reseeds) and idempotent (JSON-provided values win). |

### Definition of Done: v27 (Phases 0–3)
- [x] All new field names BIAN-prefixed (`party*` / `customerAgreement*` / `customerAgreementKycCheck*`).
- [x] One DEK per encrypted field (16 new DEKs); nested QE leaves under plaintext parent sub-docs.
- [x] Explicit `contention` on all low-cardinality `QE:equality` fields.
- [x] No PAN/CHD in any searchable QE field; no unique index on any QE field.
- [x] Plaintext helper index on `customerAgreementKycCheck.customerAgreementKycCheckStatus` only.
- [x] `technical-spec.md` §1/§2.1/§5 + seeders + setup updated in the same change.
- [x] Backend `tsc --noEmit` clean (incl. DOB → Date change).
- [ ] Phases 4–6 (search API/service, per-role UI, HRP provider) tracked in `tmp/dev.v27.plan.md`.

*Added 2026-07-16 (v27, Phases 0–3).*

## v28: Request to Pay (RTP) + shared QR

> Delivered under **development plan v28** (`tmp/dev.v28.plan.md`). BIAN-aligned Request to Pay
> as an intent domain separate from payment execution, between beneficiaries/counterparties,
> reusing FDS/HRP/AML and the balance-aware P2P transfer flow; plus a shared QR capability.
> Model: a transfer that requires the payer's in-app approval (no CIBA); balances update via hold→settle→credit.

### Objective
Let a payee create a structured payment request that a payer reviews and approves in-app
(from the transfers section) before any executable payment order is created and routed to a provider rail. Request and
payment states are independently queryable, screened, auditable, and SEPA/ISO 20022-mappable.

### FR-v28: Functional Requirements

| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| FR-v28-01 | Create/retrieve/list RTP requests | Payee creates a canonical request; requester/payer can list & fetch; idempotent create | ⏳ |
| FR-v28-02 | Independent request lifecycle | Monotonic validated transitions draft→…→settled/failed; request never merged with payment record | ⏳ |
| FR-v28-03 | Present / deliver / view / cancel / expire | State transitions emit durable, replayable events; expiry sweeper transitions + audits | ⏳ |
| FR-v28-04 | Screening (FDS/HRP/AML) | accept-time `screenTransfer` fan-out; block/hold returns machine-readable decision + opens fraud case | ⏳ |
| FR-v28-04b | VoP dedicated capability | New `vop` capability + built-in module + provider group; verify-payee + accept-time VoP as an additional independent check; market-gated (`not_supported` outside EU/UK); stub swappable; registry/seed/config updated | ⏳ |
| FR-v28-04c | VoP admin dashboard & audit UI | Dedicated `/system/admin/modules/vop` config dashboard (match thresholds, matching strategy, decision policy, market gating) editable by admin/manager like FDS; VoP in providers/groups; VoP logs + `vop.verification.completed` filterable in `/system/audit-events` with correct RBAC | ⏳ |
| FR-v28-05 | Payer approval (transfer-with-approval) | Payer sees pending requests in the transfers section and approves in-app (authenticated session); durable authorizationContext captured; no CIBA | ⏳ |
| FR-v28-06 | Accepted request → linked payment order | Approve creates a separate paymentExecutionProcedure linked by immutable reference, routed via provider | ⏳ |
| FR-v28-07 | Idempotency + audit | Duplicate create/approve are idempotent; complete tamper-evident event trail per request | ⏳ |
| FR-v28-08 | SEPA/ISO 20022 readiness | Structured address + structured remittance stored; canonical→ISO 20022 mapper present | ⏳ |
| FR-v28-09 | Shared QR representation | RTP, payment link, and redirect/checkout can issue a QR from a shared capability | ⏳ |
| FR-v28-10 | Merchant app: send/request/approve/QR | Merchant can send to and request from a beneficiary, review pending approvals, and sell a QR-paid product | ⏳ |
| FR-v28-11 | Notifications | On request delivery the payer (approver) is notified; on approval the payee (receiver) is notified; SSE badge/bell update live; alert cleared on approve/reject | ⏳ |
| FR-v28-12 | Account preconditions | Payee with no active payout account cannot request; payer with no active account cannot approve; both rejected with machine-readable reason | ⏳ |
| FR-v28-13 | Funds, screening & balance | Payer picks funding account or default; funds sufficiency (AIS) + FDS/HRP/AML checked before execution; balances of source+destination update via hold→settle→credit | ⏳ |

### Definition of Done: v28
- [ ] Requests create/deliver/view/accept/reject/cancel/expire end to end
- [ ] Accepted requests create immutable linked payment orders routed via provider
- [ ] Inter-service events durable and replayable; duplicate create/accept idempotent
- [ ] Payer approves pending requests in-app from the transfers section (authenticated session, no CIBA)
- [ ] FDS/HRP/AML can block or hold a request with machine-readable decision
- [ ] VoP runs as a dedicated capability + built-in module + provider group (additional to FDS/HRP/AML), market-gated, seed/registry/config updated, stub swappable
- [ ] VoP has its own admin dashboard at /system/admin/modules/vop (thresholds, matching strategy, decision policy, market gating) editable by admin/manager like FDS
- [ ] VoP configurable in /system/admin/providers/groups; VoP logs/events visible in /system/audit-events with correct RBAC
- [ ] Request and payment states independently queryable
- [ ] Structured remittance + structured address preserved
- [ ] Shared QR works for RTP, payment link, and checkout
- [ ] Merchant app: send + request money to a beneficiary, review pending approvals, QR-paid product
- [ ] Payer notified on request arrival; payee notified on approval; SSE badge/bell live; alert cleared on approve/reject
- [ ] Payee/payer without an active payout account are blocked from requesting/approving with a clear reason
- [ ] Payer selects funding account (or default); funds sufficiency + FDS/HRP/AML screened before execution
- [ ] Source and destination account balances update via the P2P hold→settle→credit sequence
- [ ] setup/seed/QE/indexes/ACL updated; technical-spec + demo-simulator updated

*Added 2026-07-17 (v28).*

## v29: Global card & account administration via built-in modules

> Delivered under **development plan v29** (`tmp/dev.v29.plan.md`). Moves the **global administration
> surface** (CRUD + listing) of cards (BIAN SD-88) and payout accounts (BIAN SD-66) onto the built-in
> modules behind their provider groups, respecting EDA (event bus) + Hexagonal (ports/adapters) and
> ADR-029 (Provider/Capability/Module). A built-in module is the internal fallback adapter of a
> capability's port: its administration is only enabled when the provider group resolves to the internal
> provider. **No data-model change** (same collections, fields, indexes, QE encryptedFields, DEKs); the
> only additions are data-driven (ADR-030): the `operations_officer` role and two demo users. Target
> version **2.3.0**.

### Objective
Give a dedicated back-office operator (`operations_officer`) a governed, separation-of-duties surface to
administer the whole card inventory and payout-account book, additive to the existing party-scoped
self-service routes, gated to the internal provider and fully audited (PCI DSS Req 7 + Req 10).

### FR-v29: Functional Requirements

| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| FR-29.1 | List all cards | `GET /api/v1/modules/card-issuer/cards` (paginated, filters network/status/agreement). `operations_officer` → 200 `{results,total,page,limit}`, display-safe rows (token, masked PAN, network, status, agreement, dates); no PAN/CVV/expiry. Other roles → 403. | ✅ |
| FR-29.2 | View a card | `GET .../cards/:cardId` → 200 detail; **reveals expiry (QE:none)** to `operations_officer` (see PCI note), 404 if absent; emits `card.accessed`. | ✅ |
| FR-29.3 | Register a card | `POST .../cards` (body `customerAgreementInstanceReference`) → 201; reuses `registerCardForCustomer`; dedup via registry; schema rejects CVV/PIN; emits `card.registered`. | ✅ |
| FR-29.4 | Update card metadata & status | `PATCH .../cards/:cardId` (alias/note) and `PATCH .../cards/:cardId/status` (`{active}`) → 200; reuse `updateCardMetadata`/`setCardActivation`; emit `card.updated` / `card.(de|re)activated`. | ✅ |
| FR-29.5 | Revoke a card | `DELETE .../cards/:cardId` → 200 `{removed:true}`; reuses `revokeCard`; record retained for audit; emits `card.removed`. | ✅ |
| FR-29.6 | List all accounts | `GET /api/v1/modules/account-information/accounts` (paginated, filters status/party/currency). `operations_officer` → 200 `{results,total,page,limit}`, QE-stripped rows with hints (`payoutAccountHasIban`/`payoutAccountHasRoutingNumber`). Other roles → 403. | ✅ |
| FR-29.7 | View / register / update / close account | `GET|POST|PATCH|DELETE .../accounts[/:accountRef]`; reuse `getPayoutAccount`/`createPayoutAccount`/`updatePayoutAccount`/`closePayoutAccount`; IBAN/routing QE; emit `account.created/updated/closed/accessed`. IBAN reveal stays on its existing route. | ✅ |
| FR-29.8 | Capability gate | If the capability's provider group resolves to an active external provider (priority < 999), all admin routes → 409 `managed_externally`; with only the internal provider (999) they operate normally. Covered by an integration test that registers an external provider and asserts the 409. | ✅ |
| FR-29.9 | Internal module configuration (v29.1) | `operations_officer` also holds `modules:[view,manage]` and administers the config/policies of all 11 internal modules. The `GET/PUT /api/v1/modules/<cap>/config` routes (previously unguarded) require `requirePermission('modules','view'|'manage')`. Auth (`authDomains`, SD-16) stays exclusive to `manager`. | ✅ |
| FR-29.10 | Role-aware admin landing + config edit gating (v29.2) | `operations_officer` gains `providers:[view]` (read-only) so its admin landing shows module cards with the provider status serving each capability (internal vs external / `managed_externally`); provider CRUD stays with `manager`. Editing module config is gated by `modules:manage`: `PUT /modules/<cap>/config` is exclusive to `operations_officer`; `manager` drops to `modules:view` (read-only, system/security oversight), `GET .../config` accessible by `operations_officer`, `manager`, `security_auditor`. Confirmed philosophy: `operations_officer` owns internal business logic/financial processes, `manager` owns system/platform. | ✅ |

### Definition of Done: v29
- [x] FR-29.1–29.8 with green acceptance specs.
- [x] `operations_officer` builtin role (scope `all`, `cards:[view,manage]`, `accounts:[view,manage]`, `modules:[view,manage]`, `providers:[view]`, `auditEvents:[view]`, SD-88/SD-66) added data-driven; SoD distinct from `manager` (keeps provider CRUD/authDomains/roles, holds `modules:view` only) and `customer`.
- [x] Two demo users seeded (Olivia Moreno featured, Daniel Rossi), password `demo-password`, idempotent upsert.
- [x] Role help synced: `/system/help/roles/operations_officer` renders guidance; `ROLE_LABELS` + `roleGuide` updated.
- [x] Backend + frontend `tsc --noEmit` clean; existing tests green + new (global list, CRUD, gate 409).
- [x] E2E live: create/list/edit/delete card and account as `operations_officer`; 409 with external provider; QE ciphertext intact; no CHD in responses or audit.
- [x] No model/index change (R1); if a support index had been needed it would be added only via setup + documented (none was).
- [x] `technical-spec.md` §6.13 + §RBAC + §7 (`PSP_AUDIT_LIST_ACCESS`), `PRD.md` personas/users, and this roadmap updated in the same change.
- [ ] Frontend admin views under `/system/admin/modules/{card-issuer,account-information}` (F5) tracked in `tmp/dev.v29.plan.md`.

*Added 2026-07-22 (v29).*

---

## v31: KYC & KYB Built-in Module Administration (Operations Officer)

Give the Operations Officer a production-grade administration surface for the two identity/onboarding
built-in modules, KYC (SD-53, customers) and KYB (SD-89, merchants), each split into Configuration
(built-in engine policy incl. decisionMode) and Administration (review workbench). Starting a KYC/KYB
process fans out to providers purely via the event bus; each process is tracked by one `correlationId`.

### Functional requirements

| FR | Requirement | Acceptance criteria |
|---|---|---|
| FR-31.1 | RBAC extension (SoD) | `operations_officer` gains `customers:[view,manage]` + `merchants:[view,manage]`. Administration gated by data resource; Configuration by `modules:manage`. `merchant_officer` keeps the KYB decision. Backend rejects unpermitted callers even with the UI bypassed. |
| FR-31.2 | Beneficial owners (SD-89 + SD-13) | Merchant has 1..N owners with numeric participation; exactly one primary (= scalar pointer); sum at most 100; bounded embed (cap 25); every shareholder sees the merchant. Invariants unit-tested. |
| FR-31.3 | KYB administration | List/detail/patch KYB data + owners CRUD, all index-backed, all mutations emit compliance events; PATCH rejects status writes (400). |
| FR-31.4 | KYC administration | List (L1 masked)/detail (L2 with escalation)/patch/re-screen/process endpoints; PATCH rejects status writes; emits `kyc.record.amended`. |
| FR-31.5 | KYB event orchestration | `merchant.validation.requested` fans out kyb+hrp+aml (entity) + per-owner kyc; `KybVerificationSaga` aggregates, persists the structured verdict, resolves per `decisionMode`. Events only (no service-to-service). |
| FR-31.6 | Decision mode | `decisionMode` per module; automated auto-resolves within thresholds; assisted recommends (HITL); manual = officer decides; unset defaults to manual. Sanctions/PEP never auto-approve. |
| FR-31.7 | Status coherence | Verdict and BQ:Step status set atomically via a shared mapper; internal and external paths identical. |
| FR-31.8 | Process traceability | `GET /{merchants|customer}/:id/{kyb|kyc}/process` returns the correlated timeline (bus milestones + provider wire calls). |

### Non-functional
- NFR-31.1 No regressions: full existing suite green; current flows unchanged.
- NFR-31.2 No MongoDB anti-patterns: bounded embed, multikey owner index, ESR list indexes, explain() shows IXSCAN, no COLLSCAN, no blocking SORT.
- NFR-31.3 Standards: BIAN SD-13/53/89/193, PCI Req 7/8/10/12.8, GDPR Art. 5/30/32, EU AI Act HITL for assisted.
- NFR-31.4 All schema/data changes via setup + seed; technical-spec updated in the same change.

### Definition of Done
- [x] RBAC extended in `acl.model.ts` + `role.json` + role guide, with inline SoD rationale.
- [x] `MerchantBeneficialOwner` model + invariants + unit tests; seed cap tables (2-owner 60/40, 3-owner 50/30/20, free-float 80/15); decisionMode seeded.
- [x] Multikey + ESR list indexes; explain() verified (IXSCAN, no SORT).
- [x] KYB + KYC administration endpoints + owners CRUD + process timelines.
- [x] KYB saga + reactors + decisionMode resolution + status mappers; events-only fan-out.
- [x] Frontend two-tab KYC/KYB pages, deep-linkable detail routes, owners panel, tooltips, responsive.
- [x] technical-spec section 6.13 + section 10 matrix; roadmap; ADRs; CLAUDE.md matrix obligation.
- [x] Version bump to 2.5.0 across all four package.json.

*Added 2026-07-24 (v31). Version 2.5.0.*


## v32: Worker-role visibility, defense in depth and identity-document reconciliation

Driver: a review of what `security_auditor` actually sees. Full analysis, decisions and execution log
in `tmp/dev.v32.plan.md`.

### FR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| FR-v32-01 | The beneficiary surface is a search surface, not an enumeration surface | `GET /api/v1/beneficiaries` returns 400 (`PREDICATE_REQUIRED`) for a staff caller with no `ownerRef`, `caseRef` or `q` of at least 3 characters; the rule is enforced in the service, so calling it directly also throws |
| FR-v32-02 | Cross-party beneficiary search is a distinct capability | `beneficiaries:investigate` is required for a read with no owner; `level1_analyst` holds `view` only and is refused with 403 |
| FR-v32-03 | The auditor is read-only on beneficiaries | `security_auditor` holds no `beneficiaries:manage`; the UI renders no write control for it |
| FR-v32-04 | Every disclosed beneficiary record is audited individually | one `beneficiary.record.disclosed` compliance event per record returned, naming the owner party and the predicate used (PCI DSS 10.2.2) |
| FR-v32-05 | Oversight can size the population without identifying it | `GET /api/v1/beneficiaries/aggregates` returns totals and distributions with no identifiers and emits no disclosure event |
| FR-v32-06 | The identity document has one physical source of truth | every role that can reach a customer record receives `customerAgreementGovernmentID` and `customerAgreementTaxIDNumber`; `governmentIdentificationReference` appears in no response, no fixture and no generated record |
| FR-v32-07 | A displayed value is a searchable value | the identity number rendered on `/system/users/[id]` and on the KYC administration page is byte-identical, and a `govIdNumber` suffix search on it matches |
| FR-v32-08 | Sensitive-tier values are masked for every role | address and risk notes render masked on the users and investigation pages for L1, L2 and the auditor; revealing them issues a server request that emits `kyc.sensitive.revealed` |
| FR-v32-09 | The reveal capability is named, not hardcoded | `canRevealKycSensitive` grants the Level 2 QE client; no service obtains it by passing a literal role string to `getDbForRole` |
| FR-v32-10 | Raw and debug panels never disclose | ciphertext is previewed as hex and sensitive-tier keys are redacted by name in every raw panel, including `static` sections |
| FR-v32-11 | The raw-document endpoint is authorized | staff need `view` on the resource that owns the collection; a customer reaches only records proven to be its own; the demo kill-switch cannot grant access |
| FR-v32-12 | No orphan information | `/system/users/[id]` links to the KYC record when the session holds `customers:view` and `modules:view` |
| FR-v32-13 | The KYC list states its population | the surface says it lists parties with a completed KYC record and that `initiated` records are excluded; the party-type filter offers only options that can structurally match (BIAN SD-53) |
| FR-v32-14 | Every touched page is responsive | no horizontal document scroll at 375, 834 and desktop widths; the reveal control is reachable and a long revealed value does not widen the layout |

### NFR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| NFR-v32-01 | No duplication | one field row, one group, one identity-document renderer, one masking helper, one redaction helper; the four page-local field variants are gone |
| NFR-v32-02 | Defense in depth | every restriction holds at the QE tier, the route guard, the service boundary and the projection; tests call the API directly rather than through the UI |
| NFR-v32-03 | No standards deviation | no new BIAN collection or field; `BusinessEntityType` gains `beneficiary` (SD-54) only so a disclosure event can name its own control record; EDA and Hexagonal preserved (rules in services, publish-then-project events) |
| NFR-v32-04 | The five QE search modes keep working | equality, range, prefix, suffix and substring each have an explicit test, and the pre-8.2 degradation path is asserted; predicate hardening reuses the existing per-field minimums and never raises them |

### Definition of Done

- [x] `test:unit` green (543 tests, 67 files).
- [x] Both type-checks clean.
- [x] E2E green except two failures that pre-exist on a clean tree (verified by stashing all v32 changes).
- [x] Responsive spec green on desktop, tablet and mobile projects.
- [x] `technical-spec.md` sections 1, 6.2, 6.8 and the events section updated with the code.
- [x] ADR-048 to ADR-053 recorded in `engineering-proposal.md`.
- [ ] D2 (one field-descriptor catalog served from the search registry) and the remaining
      card-to-`RecordGroup` conversion on the KYC page: deferred, see the execution log.

*Added 2026-07-29 (v32).*


## v33: Seed-data integrity and realism

Driver: an audit of the demo population found data that contradicted the storyline. Not a security
defect (no permission is bypassed and no sensitive value leaks) but a credibility one, visible to
anyone who clicks twice in front of an audience. Full analysis, decisions and execution log in
`tmp/dev.v33.plan.md`.

### FR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| FR-v33-01 | Regenerating the data never destroys the curated cast | the generator is additive: run over the fixtures, no collection's record count falls and no record present before is missing after; `write()` refuses a reduction unless `--force` is passed; a second run over its own output changes nothing (ADR-054) |
| FR-v33-02 | The deprecated identity field cannot come back | after `npm run generate:data`, no fixture contains `governmentIdentificationReference` or the string `SYNTH-`; every agreement carries a complete structured document (type, number, issuing country, expiry) whose number is long enough for a last-4 suffix query |
| FR-v33-03 | Every customer can sign in | all 57 `customer` parties hold exactly one SD-91 login; email and display name come from the party (SD-13 is the source of truth); login emails stay unique; the curated picker still returns exactly 14 featured logins; a reseed is idempotent |
| FR-v33-04 | Every transaction resolves to its card | 0 transactions carry a token matching no card; for every transaction the card it points at is held by the party its account reference belongs to; the masked PAN on the transaction equals the one derived from that card; fraud-case snapshots agree |
| FR-v33-05 | No customer is a partial record | all 57 `customer` parties hold an agreement with a KYC record, at least one card, at least one payout account and at least one transaction; David Chen gains the agreement and card he lacked while holding a login, a payout account and a merchant; each completed customer has at least one dispute or decline so the self-service view is not empty (D-3) |
| FR-v33-06 | A shared card token stays a compliance signal | `paymentCardReference` is not unique on its own; the `(agreement, token)` pair is; at least one token exceeds the 3-holder threshold so `cardHolderCount` has something to trip on; transaction repointing prefers a token unique to the holder (ADR-055) |
| FR-v33-07 | The audit cannot regress silently | one table-driven invariant test over the fixtures covers referential integrity, uniqueness, population completeness and the card link; the generator contract has its own test that runs the real script into a temporary directory |

### NFR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| NFR-v33-01 | Reuse before creation (P8) | one shared `vendors/seed/dataIntegrity.ts` called by both the generator and the runtime seeders, never the same repair written twice; masked PANs come from `deriveMaskedPan`, KYC leaves from `enrichKyc`, the deterministic seed from `screeningHash`, the token shape from the SD-57 tokenization service; the output directory reuses `PSP_SEED_DATA_DIR` |
| NFR-v33-02 | Setup and seed remain the only source of truth (P7) | every change is applied from `vendors/seed/*` plus the fixtures, both halves together; no ad-hoc migration; the database is rebuilt with `--reset` plus reseed |
| NFR-v33-03 | No standards deviation | no new collection and no new field; SD-91 authentication stays a control record separate from the SD-53 agreement, so a credential-less customer remains representable and a non-active one is expressed through `customerAuthenticationAccountStatus`; card data handling unchanged (PCI DSS: no PAN, CVV or PIN in a fixture) |
| NFR-v33-04 | Deterministic and idempotent | every derived reference comes from its parent reference, so regenerating or reseeding produces identical records rather than duplicates |

### Definition of Done

- [x] `test:unit` green (621 tests, 69 files).
- [x] Both type-checks clean.
- [x] Generator verified additive and idempotent against the real fixtures.
- [x] `technical-spec.md` §8 (seed volumes, demo users, synthetic data rules, integrity invariants) updated with the code.
- [x] ADR-054 and ADR-055 recorded in `engineering-proposal.md`.
- [ ] Database `--reset` plus reseed: performed by the user (D-2).
- [ ] E2E: the card link from a transaction detail resolves for staff. Pending the reseed.

*Added 2026-07-29 (v33).*

---

## v34: Commission settlement (the fee actually moves)

Driver: the merchant commission was recorded but never moved. `feeAmount` was persisted on the
acquiring record and a `merchant.commission.collected` event was emitted, while the payout path
hard-coded `feeAmount: 0` and credited the merchant the full gross. Nobody was debited for the fee
and no account received it, so the PSP's "revenue" existed only as an aggregation. A-06 (deferred in
ADR-041) is now closed on both legs: the fee is withheld from the gross at execution creation, and
credited to a PSP revenue ledger at settlement.

### FR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| FR-v34-01 | The commission is withheld, never added | the buyer is charged `grossAmount` and nothing else; a merchant-attributed payout execution is created with `netAmount = grossAmount − feeAmount` and its `fee` attribution sub-doc in a single insert; the rail is asked to move `netAmount`, so the commission never leaves the PSP |
| FR-v34-02 | The collected fee has a holder | a PSP revenue ledger (SD-13 `service_account` party + SD-66 `internal_ledger` account) is credited `feeAmount` at settlement, in the same movement that withholds it from the merchant hold: merchant `pendingAmount −= fee`, PSP `availableAmount += fee`; no new collection |
| FR-v34-03 | No fee means no movement | a merchant with no configured (or out-of-range) `merchantCommissionRate` yields `feeAmount 0`, no `fee` attribution, `netAmount == grossAmount` and zero balance movements, so any operation that does not state a fee stays balanced |
| FR-v34-04 | The pending hold always clears to zero | the hold is taken on the gross, so the fee leg is derived as `grossConverted − netConverted` in the merchant account currency rather than converted on its own; after settlement `pendingAmount` returns to its pre-authorization value whatever the FX rounding |
| FR-v34-05 | The cardholder is released the gross | clearing the buyer's funding hold uses `execution.grossAmount`, not the settled net, so the commission never shrinks what is released to the payer |
| FR-v34-06 | Collection is auditable and collected once | every posting writes a `balanceCreditLog` entry of `creditType: 'commission'` keyed `commission-{executionRef}` plus a `merchant.commission.settled` business process event; a replayed settlement event posts nothing further (PCI DSS Req 10) |
| FR-v34-07 | Revenue is not double counted | the dashboard `commissionRevenue` counts a card-originated commission once: the execution source contributes only fees with no acquiring counterpart (`cardTransactionInstanceReference` absent) |
| FR-v34-09 | A payout that never settles releases its reservation | every terminal path after the authorization reservation gives it back: beneficiary validation refused (`exception`), rail submission refused (`failed`), rail rejection after `in_flight` (`failed`), and any unexpected error in the pipeline (`exception`); after each one the merchant `pendingAmount` returns to its pre-authorization value |
| FR-v34-10 | The reversal does not invent money | releasing a beneficiary reservation decrements `pendingAmount` only and never credits `availableAmount`, because the funds never landed; a P2P sender keeps the existing `releaseCardHold` (pending to available) since those are its own funds |
| FR-v34-11 | Balance movements survive event redelivery | the SD-65 state transition is the idempotency gate for every balance movement in the settled and failed handlers, so a redelivered `bank.transfer.settled` or `.failed` cannot credit or reverse the same execution twice |
| FR-v34-12 | Every AIS and PISP action is auditable by transaction id | the SD-65 execution is linked to the acquiring record as soon as it is created (not after the rail accepts), each dispatch payload carries `cardTransactionInstanceReference` as the end-to-end reference, and the settled / failed / commission / hold-release events all carry `txnId`; so the audit trail's reference search returns the whole payout leg (wire I/O included, success and failure alike) from the transaction id alone |
| FR-v34-13 | A transfer already with the rail is never compensated locally | once the PISP accepts the submission the reservation belongs to the rail outcome: an error after that point annotates the record and leaves the reservation, so `bank.transfer.settled` / `.failed` remains the only thing that resolves it and `pendingAmount` cannot be double-reversed |
| FR-v34-08 | The merchant UI explains the commission | the `/products` price/commission block and the payment-result modal carry an info tooltip stating the fee is retained from the price rather than added to it, with the applied percentage |

### NFR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| NFR-v34-01 | Reuse before creation (P8) | `computeFee` stays the single commission calculation for both the acquiring and the payout path; the posting composes the existing SD-66 balance primitives (`settleCardDebit`, `creditDirect`) and adds no new balance operation; the merchant app shares one `COMMISSION_HELP` string across every commission figure |
| NFR-v34-02 | Setup and seed remain the only source of truth (P7) | the PSP revenue party and account are created by `vendors/seed/seedPspRevenueAccount.ts`; seeded commission executions credit that ledger and log it; no ad-hoc migration |
| NFR-v34-03 | A plain reseed converges (no drop required) | no collection, QE encryptedFields, DEK or index changed, so `setup:seed` alone is sufficient: the party and account upsert, and the commission credit is gated by its own credit-log entry rather than by the execution being newly inserted, so it backfills an existing database exactly once |
| NFR-v34-04 | No standards deviation | no new collection and no new model: the PSP is an SD-13 party holding an SD-66 account; SD-65 keeps `feeAmount` as the numeric source of truth with `fee` as attribution only; `commission` is not an admin-issuable credit type (system-posted only); the ledger never touches CHD |
| NFR-v34-06 | The compensation is provider-indifferent | the reversal is driven by the OUTCOME of a `dispatchProvider` call, never by which provider answered, so replacing the builtin AIS or PISP module with an external service (ADR-039) cannot leave the ledger inconsistent; a refusal, a transport error and a timeout all reach the same compensating action |
| NFR-v34-05 | Settlement is never blocked, and no amount is stranded | a missing revenue account or a lost idempotency race moves neither leg and never blocks the payout; the merchant is still credited its net; on a missing revenue ledger the fee is released to the merchant so `pendingAmount` still clears to zero, the PSP forgoing the fee rather than holding an uncollectable amount |

### Definition of Done

- [x] `test:unit` green (602 tests, 66 files), including `commissionSettlement.test.ts` (both legs, zero fee, idempotency, missing account) and `payoutHoldRelease.test.ts` (the reversal is the inverse of the reservation and credits nothing).
- [x] Both type-checks clean (backend and merchant app).
- [x] `technical-spec.md` §1 (SD-65 fee semantics, credit types, PSP revenue ledger) and §10 (ownership matrix) updated with the code.
- [x] ADR-056 and ADR-057 (including the audit-correlation decision) recorded in `engineering-proposal.md`; ADR-041's deferred A-06 note closed.
- [ ] `setup:seed` (no drop needed): performed by the user. Historical executions written before v34 keep `netAmount == grossAmount`; they are past records, not corrected by a reseed.
- [ ] E2E: a merchant payment settles, the merchant balance grows by the net and the PSP revenue ledger by the fee. Pending the reseed.

*Added 2026-07-30 (v34).*

## v35: QR surface corrections (corrective, no new capability)

Driver: the v34 analysis (`.agents/specs/dev.v34.plan.md`) evaluated the MongoDB QR payment
architecture material against the platform and concluded the capability already exists (v28: canonical
rail-agnostic `paymentRequestProcedure` + `qrPaymentRepresentation` + `RailResolver` + provider routing),
so nothing new should be built. What it did find were defects on the existing QR surface, in exactly the
controls area the source material never covers: a cleartext EPC payload carrying the creditor IBAN and
payee name on the only payment collection with neither QE nor tests, a `payloadFormat` value the API
accepted but never implemented, a state-changing route guarded at read level, and a dead unencrypted
free-shape field inviting a raw-payload store. Decisions recorded in ADR-058.

Rejected as no value (do not implement): QR ingestion engine as a separate module (would duplicate the
RTP create path), UPI/Pix/SGQR parsers, compound shard key for the static-merchant-QR hotspot
(undemonstrable on a single deployment, documented as a design only), ISO 8583 bitmap encoder, full
ISO 20022 pain.013 serialization, CPM merchant-scans-consumer flow (deferred, needs a new persona).

### FR

| Id | Requirement | Acceptance criteria |
|---|---|---|
| FR-v35-01 | The creditor PII never lands in the QR record | `encodedPayload` is durable only for `'url'`; a `'sepa_epc'` record is stored with no payload and the EPC form is derived on read from `paymentRequestProcedure` + `payoutAccountArrangement`; the stored document contains no IBAN; the issue endpoint accepts no `iban`/`payeeName`/`amount`. The collection stays plaintext with its TTL intact (QE is impossible: TTL indexes are forbidden on encrypted collections, err 6346501) |
| FR-v35-02 | An unbuildable payload format is refused, never downgraded | `payloadFormat` is `'url'` or `'sepa_epc'`; an unsupported value raises `QrPayloadError` → 400 `unsupported_payload_format`; `'sepa_epc'` on a subject other than `rtp_request` → 400 `unsupported_subject_for_format`; an unresolvable creditor account → 409 `epc_source_unavailable`; in the 400 cases no record is inserted |
| FR-v35-03 | The EPC069-12 payload stays to spec | service tag `BCD`, version `002`, charset `1`, type `SCT`, correct field order, payee name capped at 70 chars, remittance at 140, amount as `<CCY><2dp>` |
| FR-v35-04 | Issuing a QR is write-level | `POST /rtp/requests/:ref/qr` requires `paymentRequests:manage` / `write:rtp`; `level1_analyst` and `security_auditor` get 403; a customer requester passes the guard; `GET /gateway/qr/:ref` stays read-level |
| FR-v35-05 | No raw ingestion payload is retained | `paymentRequestProcedure.originalPayload` is removed; the canonical record plus `paymentRequestEvent` remain the audit history |
| FR-v35-06 | The QR lifecycle is covered by tests | `issueQr` is idempotent per `(subjectType, subjectReference)`, does not reuse an expired QR, and scopes the lookup to unconsumed records; `resolveQr` returns null for missing/consumed/expired and marks a single-use QR consumed exactly once while never consuming a reusable one |

### Definition of Done

- [x] `test:unit` green, including the new `qrRepresentation.test.ts` (16 cases) and `qrCollectionShape.test.ts` (2 cases, pinning that the collection stays unencrypted and keeps its TTL). The CH-1/CH-2 assertions were written first and confirmed failing against the pre-v35 code.
- [x] Backend and frontend type-checks clean.
- [x] Integration spec `test/backend/integration/routes/qr.test.ts` added for the permission guards (skips without `TEST_MONGODB_URI`, as the rest of the suite does).
- [x] `technical-spec.md` §14.1 (QR payload derived on read, `originalPayload` removed), §14.5 (write-level issue) and §10 (SD-65 RTP + QR ownership row, previously missing) updated with the code.
- [x] ADR-058 recorded in `engineering-proposal.md`, including the rejected QE alternative and why the TTL constraint rules it out.
- [x] **No schema change**: no new collection, field, index, DEK or QE map entry. `vendors/setup/*` and `vendors/encryption/*` change by comment only, so `setup:db` needs no reset for this iteration and no seeder changes (there is no QR seeder; QRs are issued on demand).
- [ ] E2E: a QR renders on all three consumers (RTP page, request page, `RequestMoneyModal`) and `encodedPayload` survives the response schema; a `sepa_epc` QR on a seeded RTP request renders a valid EPC payload.

*Added 2026-08-05 (v35).*
