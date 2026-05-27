# Roadmap: FR & NFR per Iteration

**Project:** FSI PCI DSS Payment Security Demo  
**PRD reference:** [PRD.md](PRD.md)  
**Engineering Proposal:** [engineering-proposal.md](engineering-proposal.md)  
**Last updated:** 2026-05-26

---

## Iterations at a glance

| Version | Theme | Goal | Target timeline |
|---|---|---|---|
| **v1** | Security Foundation | Working end-to-end: payment → QE encryption → fraud investigation | 2–3 weeks |
| **v2** | Investigation & Control | CISO-ready: RBAC, escalation, audit trail, KMS key rotation | 4–6 weeks after v1 |
| **v3** | Advanced Capabilities | Leafy Bank-ready: recurring payment, range queries, performance story | TBD after v2 validated |

---

## v1 — Security Foundation

### Objective

Deliver a runnable demo that proves MongoDB Queryable Encryption works end-to-end: a user submits a card payment, fields are encrypted client-side, and a fraud analyst finds the record by searching an encrypted field. The server never decrypts that field.

### Definition of Done

- [ ] `npm run install:all && npm run setup:db && npm run seed` completes without errors
- [ ] `docker compose up` starts both services and the demo is accessible at `http://localhost:3000`
- [ ] Payment flow completes and creates a fraud diagnosis case in Atlas
- [ ] Investigation search returns a result for an encrypted `customerEmailAddress`
- [ ] Atlas Data Explorer shows ciphertext in QE fields (not plaintext)
- [ ] Local KMS fallback works with `KMS_PROVIDER=local`
- [ ] Zero TypeScript build errors

---

### FR-v1: Functional Requirements

#### FR-v1-01 — Payment Simulation (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 01.1 | 3-step checkout form: Card Details → Review → Confirm | User completes all three steps; back navigation is supported |
| 01.2 | Card number field masks input immediately as `****-****-****-XXXX` | No raw digits are visible after entry; the field shows the last 4 only |
| 01.3 | Frontend generates a card token before calling the API | Raw PAN is never sent over the wire; the API receives only the token |
| 01.4 | Visual indicator: "Fields encrypted before leaving your browser" | Lock icon and label appear during Review step |
| 01.5 | On submission success: show Transaction ID, masked PAN, timestamp, and fraud alert banner | All four elements are displayed on the confirmation screen |
| 01.6 | Fraud alert links directly to the Investigation dashboard for that case | Clicking the alert opens the case detail view |

#### FR-v1-02 — Fraud Investigation Dashboard (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 02.1 | Search bar with field selector: `email` \| `phone` \| `account reference` \| `card token` | Selector is visible; only one field can be searched at a time |
| 02.2 | Results table shows: Transaction ID, Masked PAN, Amount, Merchant, Status, Risk Severity | All six columns are present; values are accurate |
| 02.3 | Case detail panel shows QE field indicators (lock icon on encrypted fields) | Lock icon is shown on `customerEmailAddress`, `paymentCardReference`, `customerAgreementReference` |
| 02.4 | "Encrypted in Atlas" toggle shows raw document view with ciphertext blobs | Toggle switches between business view and raw document; ciphertext is visible in raw view |
| 02.5 | Cases list supports filter by status and risk severity | Filters update results without page reload |

#### FR-v1-03 — Payment API (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 03.1 | `POST /api/v1/card-transactions` writes to `cardTransactionQE` and `cardTransactionSensitiveQE` via QE auto-encryption | QE fields in Atlas are ciphertext; plaintext fields are readable |
| 03.2 | `POST /api/v1/payment-cards` registers a tokenized card in `paymentCardQE` | Card token stored encrypted; expiry date stored as QE:none |
| 03.3 | `GET /api/v1/card-transactions/:id` returns transaction by ID | Response includes transaction metadata; sensitive fields excluded from Level 1 response |
| 03.4 | Auto-create a `fraudDiagnosisCase` when amount > 500 or MCC is in a risk list | Case is created and linked to the transaction on every triggering event |
| 03.5 | `GET /health` returns 200 with Atlas connection status | Returns `{ status: "ok", atlas: "connected" }` when Atlas is reachable |

#### FR-v1-04 — Investigation API (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 04.1 | `GET /api/v1/customer-agreements?email=<value>` performs QE equality search | Returns matching record when email value matches an encrypted field |
| 04.2 | `GET /api/v1/customer-agreements?phone=<value>` performs QE equality search | Returns matching record when phone value matches |
| 04.3 | `GET /api/v1/customer-agreements?accountRef=<value>` performs QE equality search | Returns matching record when account reference matches |
| 04.4 | `GET /api/v1/card-transactions?cardToken=<value>` performs QE equality search | Returns matching transactions for the given card token |
| 04.5 | `GET /api/v1/fraud-diagnosis-cases` returns paginated list with filters `status` and `severity` | Filtering works; response includes pagination metadata |
| 04.6 | `GET /api/v1/fraud-diagnosis-cases/:id` returns full case detail | Response includes linked transaction reference and customer reference |

#### FR-v1-05 — Database Setup & Seeding (bin/)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 05.1 | `bin/setup.ts` creates all 6 collections via `createEncryptedCollection()` | All collections exist in Atlas after setup; QE metadata is provisioned |
| 05.2 | `bin/setup.ts` provisions `DEK-lookup` and `DEK-sensitive` in `encryption.__keyVault` | Key vault contains exactly two DEK documents after setup |
| 05.3 | `bin/setup.ts` creates all indexes defined in the Technical Specification | Index exists on every field listed in the index strategy |
| 05.4 | `bin/seed.ts` inserts synthetic BIAN-compliant data into all collections | 50 customers, 50 sensitive records, 50 cards, 200 transactions, 200 sensitive transactions, 20 fraud cases |
| 05.5 | `bin/seed.ts` is idempotent — safe to re-run without creating duplicates | Running seed twice produces the same number of documents |

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

## v2 — Investigation & Control

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

---

### FR-v2: Functional Requirements

#### FR-v2-10 — Role Simulation (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 10.1 | Login screen with persona selector: Level 1 Analyst / Level 2 Investigator / Security Auditor | Three personas are available; selecting one sets the demo session role |
| 10.2 | Role badge visible in the navigation bar throughout the session | Badge shows role name and a role-specific color |
| 10.3 | Sensitive fields (`residentialAddressFull`, `governmentIdentificationReference`) show a lock icon for Level 1 | Fields are hidden and only a lock icon is visible in case detail |
| 10.4 | Level 2 sees a "Reveal sensitive fields" button after escalation approval | Button appears only in escalated cases for Level 2 role |

#### FR-v2-11 — Escalation Workflow

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 11.1 | Level 1 can trigger an escalation request on an open case | `POST /api/v1/fraud-diagnosis-cases/:id/escalate` changes status to `escalated` |
| 11.2 | Level 2 Investigator sees pending escalation cases in a dedicated queue | Cases with status `escalated` appear in the Level 2 dashboard |
| 11.3 | Level 2 approves and sensitive QE:none fields are decrypted and displayed | `residentialAddressFull` and `governmentIdentificationReference` are shown after approval |
| 11.4 | Escalation approval writes an audit event with timestamp, role, and field names accessed | Audit event persists in `fraudDiagnosisCase.diagnosisActionLog` |

#### FR-v2-12 — Audit Trail Viewer (Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 12.1 | Per-case timeline shows: datetime, action type, performing role, details | All four columns are present in the timeline |
| 12.2 | Timeline is sortable by datetime (ascending / descending) | Clicking the date header toggles sort direction |
| 12.3 | Timeline is filterable by action type (case_opened, field_accessed, escalated, case_closed) | Filter dropdown updates timeline without page reload |

#### FR-v2-13 — RBAC API Layer (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 13.1 | API reads role from `X-Demo-Role` request header | Missing header defaults to `level1_analyst` |
| 13.2 | Level 1 requests never query `customerAgreementSensitiveQE` or `cardTransactionSensitiveQE` | Collections are not touched; no sensitive fields appear in Level 1 responses |
| 13.3 | Level 2 access to sensitive collections requires a valid escalation token | Request without escalation token returns 403 |
| 13.4 | Every sensitive field access writes an audit event | `field_accessed` event is appended to the case action log |

#### FR-v2-14 — Audit Log API

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 14.1 | `GET /api/v1/audit-events?caseId=<id>` returns action log for the case | Response contains all events in chronological order |
| 14.2 | `POST /api/v1/fraud-diagnosis-cases/:id/escalate` creates escalation record | Status changes to `escalated`; escalation event is logged |

#### FR-v2-15 — Range Query Support (Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 15.1 | `GET /api/v1/card-transactions?amountMin=<n>&amountMax=<n>` performs QE range query on `transactionAmount.amount` | Returns only transactions within the encrypted amount range |
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

## v3 — Advanced Capabilities

### Objective

Make the demo Leafy Bank integration-ready and Solutions Library publishable. Add the save-card / recurring payment flow (the "browser cache" scenario raised by domain experts), a performance visualization, and optionally prefix/substring QE queries if MongoDB 8.2 is available.

### Definition of Done

- [ ] All v1 and v2 DoD criteria still pass
- [ ] "Save this card for future payments" flow works end-to-end
- [ ] Returning customer can select a saved card and complete payment without re-entering card details
- [ ] Performance comparison panel shows query time with QE vs a plaintext reference collection
- [ ] API contracts are aligned with Leafy Bank integration design
- [ ] Solutions Library article draft is created (ks-mongodb-ist-content checklist complete)

---

### FR-v3: Functional Requirements

#### FR-v3-20 — Save Card / Recurring Payment (Frontend + Backend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 20.1 | After successful payment, "Save this card for future payments" checkbox appears | Checkbox is visible on the confirmation screen |
| 20.2 | Saving a card stores the tokenized reference in `paymentCardQE` with `isPreferredCard: true` | `paymentCardQE` document exists in Atlas with correct customer link |
| 20.3 | On next payment, "Use saved card ****-1234" option appears | Previously saved card tokens are retrieved via QE equality search by `customerAgreementInstanceReference` |
| 20.4 | Selecting a saved card completes checkout without the user re-entering card details | Payment transaction is created using the stored card token |
| 20.5 | Explainer panel: "No card data is stored in your browser — only a token, encrypted in Atlas" | Panel is visible on the saved card selection screen |

#### FR-v3-21 — Performance Visualization (Backend + Frontend)

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 21.1 | `GET /api/v1/diagnostics/query-timing` runs the same equality search on the encrypted collection and a plaintext shadow collection | Both queries execute and timing data is returned |
| 21.2 | Response includes timing in milliseconds for both queries | `{ encrypted_ms: number, plaintext_ms: number, overhead_pct: number }` |
| 21.3 | Frontend displays a side-by-side comparison panel with the timing values | Panel is visible in the investigation dashboard; values update on each search |

#### FR-v3-22 — Leafy Bank Integration Scaffold

| # | Requirement | Acceptance Criteria |
|---|---|---|
| 22.1 | API response shapes are aligned with Leafy Bank API contract design | No breaking changes needed for Leafy Bank integration |
| 22.2 | Authentication contract defined: JWT header structure compatible with Leafy Bank auth service | Documented in technical-spec.md |

---

### NFR-v3: Non-Functional Requirements

| ID | Category | Requirement | Measure |
|---|---|---|---|
| NFR-v3-01 | Performance | QE overhead for equality search is below a defined threshold | Overhead < 20% vs plaintext on Atlas M10 under single-user demo load |
| NFR-v3-02 | UX | Returning customer payment with saved card completes in fewer steps than first-time payment | Saved card flow requires ≤ 2 steps vs 3 for new card |
| NFR-v3-03 | Portability | Demo can be embedded into Leafy Bank with ≤ 1 week of integration work | Integration scaffold validated by Leafy Bank team review |
| NFR-v3-04 | Content readiness | Solutions Library article passes the four-section template check | Validated using ks-mongodb-ist-content checklist |

---

## Cross-iteration NFRs

These requirements apply to all versions from v1 onward:

| ID | Category | Requirement |
|---|---|---|
| NFR-X-01 | Data safety | Synthetic data only — no real PAN, CVV, PIN, government ID, or address |
| NFR-X-02 | PCI compliance | SAD (CVV, PIN, magnetic stripe) is never stored in any collection at any version |
| NFR-X-03 | Security | `.env` file is excluded from git; no secrets in source code or committed files |
| NFR-X-04 | Accessibility | LeafyGreen components used — WCAG 2.1 AA compliance inherited from the design system |
| NFR-X-05 | Documentation | Every new API endpoint added at any version is documented in technical-spec.md before merging |
| NFR-X-06 | Type safety | `npm run build` exits 0 at every version — no TypeScript `any` escape hatches in production code |
