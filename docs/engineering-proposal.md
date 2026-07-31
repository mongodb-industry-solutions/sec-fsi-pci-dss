# EP: FSI PCI DSS Payment Security Demo

## Status

Draft  
Version: 1.4: Author: Antonio Membrides Espinosa: Last updated: 2026-06-10  
PRD reference: [docs/PRD.md](PRD.md)

---

## 1. Background

A digital bank or card issuer needs to investigate suspicious card transactions quickly, but storing cardholder data in plaintext expands PCI DSS scope and introduces insider threat risk. MongoDB Queryable Encryption (QE) resolves this by allowing the server to search encrypted fields without ever decrypting them. This EP defines how to build the demo that proves that claim end-to-end: from card checkout to fraud investigation: structured around BIAN Service Domain naming and backed by AWS KMS.

Full business context, problem statement, and storyline are in [PRD.md](PRD.md). This document covers only technical decisions, trade-offs, and implementation phases.

---

## 2. Goals and non-goals

### Goals

- Define the fullstack TypeScript architecture (`frontend/` + `backend/`) and repository layout.
- Specify the QE encryption design: which collections use QE, which fields, which DEKs, and which query types per iteration.
- Define the BIAN-aligned MongoDB data model (7 collections) and application-side join strategy.
- Specify the dual-mode frontend: Simulator Mode (presenter-controlled, no login) and Application Mode (JWT login, role-based routing).
- Define the JWT authentication design (local HS256 domain, pre-seeded demo users, extensible to MS Entra ID).
- Specify the Fastify REST API surface and request/response contracts.
- Define the `backend/bin/setup.ts` and `backend/bin/seed.ts` scripts so the demo is installable in one sequence of commands.
- Identify the risks specific to QE implementation and specify mitigations.
- Break the work into five independently deliverable phases aligned with v1, v2, v3, v4, and v5.

### Non-goals

- UI/UX design: covered by the IST demo design standards (LeafyGreen).
- PCI DSS compliance certification: this is a reference architecture, not a compliance audit.
- Production hardening (rate limiting, DDoS protection, production secret management): out of scope for a demo.
- Multi-region Atlas deployment: a single-region cluster is sufficient for the demo story.

---

## 3. Proposed solution

### 3.1 Architecture overview

```
Browser (Next.js App Router)
    │  HTTP JSON: no DB access, no secrets, no business logic
    ▼
Fastify API  (:3001)
    │  MongoDB Node.js driver with auto-encryption (crypt_shared)
    │  KMS call on first client init only (DEK unwrap)
    ▼
MongoDB Atlas  (M10+)
    │  Stores ciphertext: never sees plaintext for QE fields
    ▼
AWS KMS
    Customer Master Key: MongoDB has zero access
    QE driver contacts KMS only when unwrapping the DEK
```

**MACH alignment:**
- **M**: Backend is modular: controllers, services, encryption layer are independent.
- **A**: API-first: every UI action maps to a documented endpoint in [technical-spec.md](technical-spec.md) §6.
- **C**: Cloud-native: MongoDB Atlas, no local MongoDB in production path.
- **H**: Headless: frontend calls the API; it never touches MongoDB or holds secrets.

### 3.2 Repository structure decision

Two named top-level folders per IST Engineering Standards:

```
frontend/     ← Next.js 14 App Router
backend/      ← Fastify 4 (controllers / services / models / encryption)
  bin/        ← setup.ts + seed.ts (owned by backend; invoked via npm --prefix backend)
  data/       ← JSON seed files (one per collection; consumed only by backend/bin/seed.ts)
test/         ← All automated tests (Vitest unit + integration, Playwright E2E)
  backend/    ←   mirrors backend/src/ — unit/services/ + integration/routes/
  frontend/   ←   mirrors frontend/src/ — unit/lib/ + unit/components/ + e2e/
docs/         ← PRD, roadmap, technical-spec, this EP
```

`bin/` and `data/` live inside `backend/` because they call `backend/src/vendors/` directly. The root `package.json` delegates with `npm run setup:db --prefix backend` and `npm run setup:seed --prefix backend`.

No `packages/` shared workspace. The backend owns all MongoDB access and all encryption logic. The frontend is a pure HTTP consumer. Shared TypeScript base config lives in `tsconfig.base.json`.

**Why not a shared `packages/db/` workspace?**  
The only consumer of the QE client is the backend. A shared package adds workspace overhead and a cross-package build dependency for zero gain. See [§7: Alternatives considered](#7-alternatives-considered).

### 3.3 Data model

Seven MongoDB collections following BIAN Service Domain naming. Full TypeScript interfaces are in [technical-spec.md §1](technical-spec.md#1-bian-typescript-models).

```
partyAuthentication  ← BIAN SD-16: demo users + JWT auth (email QE:equality)

customerAgreementProcedure  [inline QE:none: address, govId, riskNotes]
       │
       │ 1:many (via customerAgreementInstanceReference, plaintext)
       ▼
paymentCardManagement  ─────────────────────────────────────────────────────┐
       │ (via paymentCardReference token, standard index)                   │
       │ many:1                                                             │
       ▼                                                                    │
cardTransactionLog  [inline QE:none: rawGatewayPayload, processorMetadata]  │
       │                                                                    │
       │ 1:many                                                             │
       ▼                                                                    │
fraudDiagnosisCase ◄── also links ──────────────────────────────────────────┘
   (linkedCustomerAgreementReference + linkedCardTransactionReference)
```

**Payment token (paymentCardReference):** Stored as plaintext with a standard MongoDB index — not in QE. A payment token is a card surrogate under PCI DSS v4.0: it is not Cardholder Data (CHD) and does not require QE protection. QE equality applies only to genuine PII/CHD fields (`customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`, `customerAgreementReference`).

**Join strategy:** Application-side sequential queries. The backend service layer queries each collection independently and assembles the response. No `$lookup` across QE collections: it is not supported for encrypted fields in the current QE implementation.

**QE tier rationale (v2):** QE:none sensitive fields are stored **inline** in `customerAgreementProcedure` and `cardTransactionLog`. The access-control boundary is the QE client tier, not a separate collection: the Level 1 `encryptedFieldsMap` omits QE:none fields so the driver returns Binary ciphertext, which the API projection layer strips. Level 2 uses a separate QE client with a complete `encryptedFieldsMap` that auto-decrypts all fields after escalation token validation. This follows the BIAN Control Record model (all attributes of a SD in one collection) while preserving cryptographic enforcement.

### 3.4 Queryable Encryption design

Two DEKs:

| DEK | Wraps | Collections | Access |
|---|---|---|---|
| `DEK-lookup` | AWS CMK | `cardTransaction`, `customerAgreement`, `paymentCard`, `partyAuthentication` | All service roles |
| `DEK-sensitive` | AWS CMK | QE:none fields inline in `cardTransactionLog` and `customerAgreementProcedure` | Level 2 + escalation token only (v2) |

Complete `encryptedFieldsMap` definitions are in [technical-spec.md §2](technical-spec.md#2-qe-encryptedfieldsmaps).

**v1 query types:** equality only: `cardTransactionAccountReference`, `customerEmailAddress`, `customerMobilePhoneNumber`, `customerAgreementReference`, `authenticationUserEmailAddress`.  
`paymentCardReference` (card token) is **not** a QE field — it is stored plaintext and searched via a standard MongoDB index. See ADR-003.

**v2 addition:** range query on `transactionAmount.amount` (`min: 0`, `max: 999999`, `precision: 2`).

**v3 consideration:** prefix/substring queries on `customerName` if MongoDB 8.2 prefix/suffix QE is GA.

### 3.5 API design

Full contracts are in [technical-spec.md §6](technical-spec.md#6-api-contracts). Summary:

```
POST   /api/v1/auth/login                 JWT login (returns signed token)
GET    /api/v1/customer?email=                  QE equality search                 ← module: customer / SD-53
GET    /api/v1/customer?phone=                  QE equality search
GET    /api/v1/customer?accountRef=             QE equality search
GET    /api/v1/customer/:customerId/cards        list customer cards                ← module: customer / SD-88
POST   /api/v1/customer/:customerId/cards        register card for customer
POST   /api/v1/transactions              create transaction (triggers fraud case)   ← module: transactions / SD-254
GET    /api/v1/transactions/:id          get transaction by ID
GET    /api/v1/system/raw/:collection/:id raw Atlas document (plain MongoClient, for simulator toggle; dev-only)
GET    /api/v1/transactions?cardToken=   list by card token (standard index, not QE)
GET    /api/v1/fraud                     list cases (filter: status, severity)      ← module: fraud / SD-83
GET    /api/v1/fraud/:id                 case detail
POST   /api/v1/fraud/:id/escalate        [v2]
GET    /api/v1/fraud/:id/events          audit events per case
POST   /api/v1/fraud/:id/notes           add a note event (internal or customer-visible)  ← Ch-03
DELETE /api/v1/fraud/:id/notes/:noteId   retract a note (appends note_retracted event)     ← Ch-03
GET    /api/v1/transactions/:id/notes    list note events for a transaction case            ← Ch-03
GET    /api/v1/diagnostics/query-timing  [v3]
GET    /api/v1/system/health
```

### 3.6 Security considerations

**Encryption boundary:** The MongoDB Node.js driver with `autoEncryption` encrypts fields in the Fastify process before the BSON document is sent to Atlas. The Atlas server stores and indexes ciphertext only.

**Key management:**
- AWS CMK is customer-owned. MongoDB support cannot access it.
- DEKs are stored encrypted in `encryption.__keyVault`. Plaintext DEKs exist only transiently in Fastify process memory during a session.
- Two DEKs enforce a coarse access split between lookup and sensitive fields. In production, each collection should have its own DEK.

**Credential handling:**
- All secrets in `.env` (excluded from git via `.gitignore`).
- `.env.example` has no real values.
- The frontend never receives MongoDB credentials, AWS credentials, or DEKs.

**PAN / SAD rules enforced by design:**
- Full PAN is never accepted by the API: the frontend tokenizes before calling.
- CVV and PIN are not accepted at any API endpoint.
- Seed data contains no real card numbers; synthetic tokens only.

**Authentication (v1):**
- `POST /api/v1/auth/login` validates email + password against `partyAuthentication` (bcrypt hash). Returns a signed HS256 JWT.
- Five pre-seeded demo roles: `customer`, `level1Analyst`, `level2Investigator`, `auditor`, `admin`.
- The frontend's Application Mode shows a user-selector dropdown at the login screen (no password required for demo flow).
- The auth domain is configurable: `AUTH_DOMAIN=local` (default) uses the seeded users; `AUTH_DOMAIN=msentra` delegates to MS Entra ID (future).
- `authenticationUserEmailAddress` in `partyAuthentication` is QE:equality for demo completeness — the same QE search story applies to auth lookup.

**v2 RBAC:**
- JWT `role` claim drives field projection in API responses (replaces the earlier `X-Demo-Role` header pattern).
- Level 2 access to sensitive collections requires an escalation token (generated by the escalation workflow, validated by middleware).
- The escalation token is a short-lived UUID stored in `fraudDiagnosisCase`: not a JWT (stateless tokens cannot be invalidated if the escalation is revoked).

### 3.7 Testing strategy

All tests live in `test/` at the repository root, organised by layer and type (IST engineering standard §7a):

```
test/
├── setup.ts                          ← global Vitest setup
├── backend/
│   ├── unit/services/                ← mirrors backend/src/services/
│   └── integration/routes/           ← mirrors backend/src/controllers/
└── frontend/
    ├── unit/lib/                     ← mirrors frontend/src/lib/
    ├── unit/components/              ← mirrors frontend/src/app/components/
    └── e2e/                          ← Playwright flow specs
```

| Level | Scope | Tool | Location |
|---|---|---|---|
| Unit | Service layer functions in isolation (mock MongoDB client) | **Vitest** | `test/backend/unit/` |
| Unit | Frontend lib helpers (auth, constants, API client) | **Vitest + jsdom** | `test/frontend/unit/` |
| Integration | API routes against a real Atlas cluster with QE active | **Vitest + Supertest** | `test/backend/integration/` |
| E2E | Full payment-to-investigation flow in the browser | **Playwright** | `test/frontend/e2e/` |
| Security | Level 1 cannot access sensitive collections; no plaintext PAN in any response | Integration tests | `test/backend/integration/` |

See [docs/installation.md](installation.md) §5 for all commands to run the test suite.

**QE-specific tests:**
- Insert a document with QE fields; verify ciphertext in Atlas Data Explorer (manual or Atlas API call).
- Search by encrypted field value; verify the correct document is returned.
- Attempt to query an encrypted field without the QE client (plain MongoClient); verify the field is opaque.

---

### 3.8 Backend module architecture and BIAN map

**Decision:** The backend `src/` is organized into domain modules. Each module owns its controllers, services, and models. Cross-module resources live in `shared/` (business logic shared by 2+ modules) or `vendors/` (infrastructure shared by all modules).

**Rule for placement:**

| Resource type | 1 module uses it | 2+ modules use it |
|---|---|---|
| Interface / type | inside the module's `models/` | `shared/models/` |
| Business service | inside the module's `services/` | `shared/services/` |
| Fastify middleware / plugin | `vendors/middleware/` or `vendors/plugins/` | (always cross-cutting) |
| Encryption client, KMS, DEKs | `vendors/encryption/` | (always cross-cutting) |
| DevOps (setup, seed) | `vendors/setup/` or `vendors/seed/` | (always cross-cutting) |

#### 3.8.1 BIAN Module Map

Each module maps to one or more BIAN Service Domains. No module exists without a SD reference.

| Module | BIAN SD | SD Name | Collections | QE Classification | API Prefix | PCI CDE Scope |
|---|---|---|---|---|---|---|
| `identity` | SD-16 | Party Authentication | `partyAuthentication` | `equality` on email | `/api/v1/auth` | Adjacent — auth only |
| `customer` | SD-53 · SD-88 | Customer Agreement · Payment Card | `customerAgreementProcedure` · `paymentCardManagement` | `equality` on accountRef; `none` (inline) on address / govId / riskNotes / expirationDate | `/api/v1/customer` · `/api/v1/customer/:id/cards` | **In scope** — PII/CHD |
| `transactions` | SD-254 | Card Transaction | `cardTransactionLog` | `equality` on accountRef; `none` (inline) on rawGatewayPayload / processorMetadata | `/api/v1/transactions` | **In scope** — CHD |
| `fraud` | SD-83 | Fraud Diagnosis | `fraudDiagnosisCase` · `fraudDiagnosisCaseEvents` | None — operational metadata, FK refs only | `/api/v1/fraud` · `/api/v1/fraud/:id/events` | Adjacent — references CDE keys |
| `gateway` *(v4)* | SD-64 · SD-65 · SD-89 · SD-57 | Payment Order · Payment Execution · Merchant Relations · Card Etoken | `merchantAgreement` · `paymentOrder` · `tokenVault` | `none` on merchantApiKeyHash · `equality` on merchant/customer refs | `/api/v1/gateway` | **In scope** — merchant secrets + payment refs |
| `system` | — | Demo infrastructure | None | None | `/api/v1/system/health` · `/api/v1/system/raw/:collection/:id` | Non-CDE — raw endpoint blocked in production |

#### 3.8.2 Shared resources

| File | Exported types | Consuming modules |
|---|---|---|
| `shared/models/risk.model.ts` | `RiskSeverity` · `FraudTriggerInput` | `transactions` · `fraud` · `gateway` (v5) |
| `shared/models/identity.model.ts` | `UserRole` · `AnalystRole` · `JwtDemoPayload` | `identity` · `fraud` · `gateway` (v5) |
| `shared/models/transaction.model.ts` | `TransactionSnapshot` | `fraud` (defines embedded field) · `transactions` (builds the value at write time) |
| `shared/services/fraudTrigger.service.ts` *(v4)* | `triggerFraudEvaluation()` | `transactions` · `gateway` — activated when gateway also triggers fraud cases |

Until v5, `transactions` calls `createFraudCase()` from `modules/fraud/` directly. The shared service is introduced only when a second caller (gateway) makes the duplication worth extracting.

#### 3.8.3 Vendor resources (infrastructure, not business logic)

| Directory | Contents | Used by |
|---|---|---|
| `vendors/encryption/` | `qeClient.ts` · `rawClient.ts` · `kms.ts` · `keyVault.ts` · `encryptedFieldsMaps.ts` | `customer` · `transactions` · `identity` · `gateway` (v5) |
| `vendors/middleware/` | `auth.ts` · `rbac.ts` | All modules via `server.ts` Fastify hooks |
| `vendors/setup/` | `createCollections.ts` · `createIndexes.ts` · `provisionDEKs.ts` | `bin/setup.ts` only |
| `vendors/seed/` | `seedUsers.ts` · `seedCustomers.ts` · `seedCards.ts` · `seedTransactions.ts` · `seedCases.ts` · `seedMerchants.ts` (v4) | `bin/seed.ts` only |

#### 3.8.4 Module dependency graph

```
server.ts
  ├── vendors/middleware/auth.ts       ← Fastify preHandler hook (all routes)
  ├── vendors/middleware/rbac.ts       ← Fastify preHandler hook (protected routes)
  │
  ├── modules/identity/               SD-16
  ├── modules/customer/               SD-53
  ├── modules/transactions/           SD-254 + SD-88
  │     └── imports createFraudCase ────────────────────────────────────────┐
  ├── modules/fraud/                  SD-83  ◄──────────────────────────────┘
  │
  ├── modules/gateway/ [v4]           SD-64 + SD-65 + SD-89 + SD-57
  │     └── imports triggerFraudEvaluation ──► shared/services/fraudTrigger ──► modules/fraud/
  │
  └── modules/system/                 demo infra (NODE_ENV !== 'production' only)

shared/models/   ←── imported by any module that needs the type (no runtime cost)
vendors/encryption/  ←── imported by QE-enabled modules only
```

PCI CDE boundary at code level: modules `customer`, `transactions`, and `gateway` (v5) are in scope. `fraud` and `identity` are adjacent. `system` is non-CDE. This mirrors the network segmentation principle in [psp-architecture.md §7.2](psp-architecture.md).

#### 3.8.5 Backend source structure

```
backend/src/
├── shared/
│   ├── models/
│   │   ├── risk.model.ts             RiskSeverity · FraudTriggerInput
│   │   ├── identity.model.ts         UserRole · AnalystRole · JwtDemoPayload
│   │   └── transaction.model.ts      TransactionSnapshot
│   └── services/
│       └── fraudTrigger.service.ts   [v4] triggerFraudEvaluation()
│
├── vendors/
│   ├── encryption/
│   │   ├── qeClient.ts
│   │   ├── rawClient.ts
│   │   ├── kms.ts
│   │   ├── keyVault.ts
│   │   └── encryptedFieldsMaps.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── rbac.ts
│   ├── setup/
│   │   ├── index.ts
│   │   ├── createCollections.ts
│   │   ├── createIndexes.ts
│   │   └── provisionDEKs.ts
│   └── seed/
│       ├── index.ts
│       ├── seedUsers.ts
│       ├── seedCustomers.ts
│       ├── seedCards.ts
│       ├── seedTransactions.ts
│       ├── seedCases.ts
│       └── seedMerchants.ts          [v4]
│
└── modules/
    ├── identity/                     SD-16: Party Authentication
    │   ├── controllers/auth.controller.ts
    │   ├── services/auth.service.ts
    │   ├── models/partyAuthentication.model.ts
    │   └── index.ts                  Fastify plugin → registers /auth/*
    │
    ├── customer/                     SD-53: Customer Agreement
    │   ├── controllers/customerAgreement.controller.ts
    │   ├── services/customerAgreement.service.ts
    │   ├── models/customerAgreement.model.ts
    │   └── index.ts                  Fastify plugin → registers /customer + /customer/:id/cards
    │
    ├── transactions/                 SD-254: Card Transaction · SD-88: Payment Card
    │   ├── controllers/
    │   │   ├── cardTransaction.controller.ts
    │   │   └── paymentCard.controller.ts
    │   ├── services/
    │   │   ├── cardTransaction.service.ts
    │   │   └── paymentCard.service.ts
    │   ├── models/
    │   │   ├── cardTransaction.model.ts
    │   │   └── paymentCard.model.ts
    │   └── index.ts                  Fastify plugin → registers /transactions
    │
    ├── fraud/                        SD-83: Fraud Diagnosis
    │   ├── controllers/fraudDiagnosis.controller.ts
    │   ├── services/fraudDiagnosis.service.ts
    │   ├── models/fraudDiagnosis.model.ts
    │   └── index.ts                  Fastify plugin → registers /fraud (+ /fraud/:id/events in v2)
    │
    ├── gateway/                      [v4] SD-64+SD-65+SD-89+SD-57
    │   ├── controllers/
    │   │   ├── merchant.controller.ts
    │   │   ├── payment.controller.ts
    │   │   ├── token.controller.ts
    │   │   └── webhook.controller.ts
    │   ├── services/
    │   │   ├── merchant.service.ts
    │   │   ├── paymentOrder.service.ts
    │   │   ├── routing.service.ts
    │   │   ├── tokenization.service.ts
    │   │   └── webhook.service.ts
    │   ├── models/
    │   │   ├── merchantAgreement.model.ts    SD-89
    │   │   ├── paymentOrder.model.ts         SD-64
    │   │   └── tokenVault.model.ts           SD-57
    │   └── index.ts                  Fastify plugin → registers /gateway/*
    │
    └── system/                       Demo infrastructure (non-BIAN)
        ├── controllers/demo.controller.ts
        └── index.ts                  Registered only when NODE_ENV !== 'production'
```

`server.ts` registers modules as Fastify plugins:

```typescript
await fastify.register(identityModule,     { prefix: '/api/v1' });
await fastify.register(customerModule,     { prefix: '/api/v1' });
await fastify.register(transactionsModule, { prefix: '/api/v1' });
await fastify.register(fraudModule,        { prefix: '/api/v1' });
await fastify.register(gatewayModule,      { prefix: '/api/v1' });   // v4
if (process.env.NODE_ENV !== 'production')
  await fastify.register(systemModule,     { prefix: '/api/v1' });
```

The API URL surface follows REST nesting and module semantics: `/api/v1/customer` (SD-53), `/api/v1/customer/:id/cards` (SD-88 sub-resource), `/api/v1/transactions` (SD-254), `/api/v1/fraud` (SD-83).

---

## 4. Implementation phases

| Phase | Scope | Dependency | Version |
|---|---|---|---|
| **P1** | `backend/bin/setup.ts`: 7 collections, DEK provisioning, indexes | None | v1 |
| **P2** | `backend/bin/seed.ts`: synthetic data for all 7 collections (incl. 5 demo users) | P1 | v1 |
| **P3** | Backend: QE client, KMS provider factory, `encryptedFieldsMap` | P1 | v1 |
| **P3a** | Backend: JWT auth middleware + `POST /api/v1/auth/login` endpoint | P3 | v1 |
| **P4** | Backend: payment API (`POST /transactions`, `POST /cards`) | P3 | v1 |
| **P5** | Backend: investigation API (QE equality searches, fraud cases, raw document endpoint) | P3, P4 | v1 |
| **P6** | Frontend: Simulator Mode — payment simulation flow (checkout, token gen, encryption toggle) | P4 | v1 |
| **P6a** | Frontend: dual-mode landing page + Application Mode shell (login, role selector, JWT flow) | P3a | v1 |
| **P7** | Frontend: investigation dashboard in Application Mode (search, case detail) | P5, P6a | v1 |
| **P8** | Docker Compose + `docker compose up` smoke test | P4, P5, P6, P6a, P7 | v1 |
| **P9** | Backend: RBAC middleware + Level 1/2 field projection driven by JWT role claim | P3a | v2 |
| **P10** | Backend: escalation endpoint + audit event log | P9 | v2 |
| **P11** | Backend: QE range query on `transactionAmount.amount` | P3 | v2 |
| **P12** | Frontend: role badge, escalation workflow UI, audit trail panel | P9, P10 | v2 |
| **P13** | Backend: `POST /cards` save-card + returning-customer recurring payment | P3 | v3 |
| **P14** | Frontend: save card flow, returning-customer payment | P13 | v3 |
| **P15** | Backend: `/diagnostics/query-timing` | P5 | v3 |
| **P16** | Frontend: performance comparison panel | P15 | v3 |
| **P17** | Backend: structural refactor — create `src/modules/` + `src/shared/` layout; move all existing files; no functional change | P16 | v4 |
| **P18** | Backend: extract shared types to `shared/models/` (`risk`, `identity`, `transaction`) | P17 | v4 |
| **P19** | Backend: create module `index.ts` Fastify plugins; update `server.ts` registration | P18 | v4 |
| **P20** | Backend: gateway module — BIAN models (`merchantAgreement`, `paymentOrder`, `tokenVault`) | P19 | v4 |
| **P21** | Backend: gateway services (merchant, paymentOrder, routing, tokenization, webhook) | P20 | v4 |
| **P22** | Backend: gateway controllers + `index.ts` plugin; update `encryptedFieldsMaps` + `createCollections` + `createIndexes` | P21 | v4 |
| **P23** | Backend: merchant + gateway seed data; update `bin/seed.ts` | P22 | v4 |
| **P24** | Frontend: gateway simulator step + merchant profile view in Application Mode | P22, P23 | v4 |
| **P25** | Backend + Frontend: AI agent integration (Magenta, `agentDraftDiagnosis` field) | P5 | v5 |
| **P26** | Frontend: AI draft inline panel (Accept / Override / Dismiss) | P25 | v5 |
| **P27** | Backend: bank-transfer rail engine (`shared/services/bankTransfer`: RailResolver, FeeCalculator, IBAN/BIC/ABA validators, return-code maps) | P19 | Add-on (dev v17) |
| **P28** | Backend: provider-based transfer execution — `bankTransfer.service` + `dispatchProvider`; refactor `payoutOrchestration` + `p2pTransfer` off direct builtin imports; async settlement | P27 | Add-on (dev v17) |
| **P29** | Backend: pre-initiation risk gate (`transferRiskGate`: FDS/HRP/AML) with L1 fraud-case opening on block | P28 | Add-on (dev v17) |
| **P30** | Backend: recurring mandates (ACH SDD / SEPA SDD) — model, service, API, background scheduler | P28 | Add-on (dev v17) |
| **P31** | Backend: transfer status endpoint + idempotency store + config-driven fees/sandbox | P28 | Add-on (dev v17) |
| **P32** | Frontend: `/system/transfer/bank` — rail auto-detect, live validation, fee, status polling, recurring Direct Debit | P28, P31 | Add-on (dev v17) |

See ADR-039 (§ADRs) and `tmp/dev.v17.plan.md` for the detailed v17.1 change plan and progress board.

---

## 5. Migration plan

No existing data or users. Every setup starts from scratch:

```
npm run setup:db   → creates collections + provisions DEKs + creates indexes
npm run setup:seed → inserts synthetic data
```

Re-seeding uses upsert operations (idempotent). Running `setup:db` twice is safe: `getOrCreate` logic in `keyVault.ts` skips DEK creation if the key already exists.

If a breaking schema change is needed (e.g., adding a QE range field), the collection must be dropped and recreated via `createEncryptedCollection()`: QE does not support `ALTER`-equivalent operations. The `--reset` flag on setup drops and recreates all collections.

---

## 6. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `crypt_shared` library version mismatch with the MongoDB Node.js driver | Medium | High | Pin both `mongodb` and `mongodb-client-encryption` to the same minor version; document in `package.json` peer dependency notes |
| AWS KMS latency degrades demo flow | Low | Medium | Cache the unwrapped DEK in memory for the process lifetime; only call KMS on startup |
| Atlas M0 / M2 / M5 (free tier) used by a developer: QE not supported | High | High | Gate `bin/setup.ts` with a cluster tier check; fail fast with a clear error message |
| QE `$lookup` limitation breaks a planned join | Low | High | All joins are application-side sequential queries: no `$lookup` used. Documented in ADR-001 |
| Seed data accidentally includes real PAN format | Medium | High | Seed generator always prefixes tokens with `pm_`; grep CI check rejects any string matching `\b\d{13,19}\b` |
| Key vault DEK reference lost (collection dropped without DEK cleanup) | Low | High | `bin/setup.ts --reset` drops collections then recreates DEKs; order is enforced in script |
| Demo breaks at conference due to AWS KMS unavailability | Low | High | Local KMS fallback is always available with `PSP_KMS_PROVIDER=local`; test it before travel |

---

## 7. Alternatives considered

### Alternative A: Shared `packages/db/` workspace (Turborepo)

A shared MongoDB package used by both `backend/` and `bin/` scripts.

**Pros:** Clean separation of DB concern; `frontend/` cannot accidentally import DB code.  
**Rejected because:** The frontend never imports DB code regardless (headless principle). The only two consumers of QE client code are `backend/` and `bin/`: which is a thin justification for a shared package with its own `package.json`, version, and build pipeline. Adds build complexity (Turborepo or `tsc -b` project references) with no functional benefit for a demo. If the project scales to multiple backends, this decision should be revisited.

### Alternative B: CSFLE alongside QE

Use CSFLE for non-searchable fields and QE only for equality-searchable fields (as suggested in the original backlog).

**Pros:** More granular encryption control; CSFLE fields have no QE server-side metadata overhead.  
**Rejected because:** Mixing CSFLE and QE in the same demo complicates the explanation significantly. For a demo audience, one encryption method with two query modes (`equality` and `none`) is far easier to explain than two separate encryption mechanisms. QE with `queryType: none` achieves the same result as CSFLE for non-searchable fields, with the additional benefit that the same `autoEncryption` client handles both cases.

### Alternative C: Next.js API Routes as the backend (monolithic)

Use Next.js Route Handlers (App Router) as the API layer, eliminating the need for a separate `backend/` application.

**Pros:** Fewer moving parts; one process; simpler Docker setup.  
**Rejected because:** IST Engineering Standards require API-first (Headless principle of MACH). A Route Handler inside Next.js couples business logic and database access to the presentation layer. The QE `autoEncryption` client would run inside the Next.js process: making server components, route handlers, and the QE client share the same Node.js process and environment, which complicates credential scoping and makes the RBAC boundary unclear. A separate Fastify process makes the API contract explicit and independently testable.

### Alternative D: Separate DEK per collection

Each of the five QE-protected collections has its own dedicated DEK.

**Pros:** Maximum key isolation; rotating one collection's DEK does not affect others.  
**Rejected for v1 because:** Managing five DEKs in a demo adds significant setup complexity and makes the KMS key vault explanation harder to follow. Two DEKs (`DEK-lookup` and `DEK-sensitive`) express the meaningful access boundary: anyone with lookup access vs. only Level 2 with sensitive access. This note is kept in the technical spec as a production recommendation.

---

## 8. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| 1 | Should the escalation token (v2) be a short-lived UUID or a signed JWT? A UUID is preferred: stateless JWTs cannot be invalidated if escalation is revoked mid-session. | Engineering Lead | Before P9 starts |
| 2 | Is QE prefix/substring available in the Atlas cluster version targeted for v4? | Engineering Lead | Before P17 starts |
| 3 | Does the Leafy Bank integration require a shared auth service or is the role selector sufficient for v4? | IST Team / Leafy Bank team | Before P15 starts |
| 4 | What is the Magenta API endpoint and authentication model for the v5 AI agent integration? | IST Team / MongoDB Magenta team | Before P25 starts |

---

## 9. Estimates

| Phase group | Phases | Estimate | Confidence |
|---|---|---|---|
| v1: Setup + seeding (7 collections) | P1, P2 | 1.5 days | High |
| v1: Backend QE + Auth + APIs | P3, P3a, P4, P5 | 3.5 days | High |
| v1: Frontend (Simulator + App Mode) | P6, P6a, P7 | 4 days | Medium (UI polish varies) |
| v1: Docker + QA | P8 | 1 day | High |
| **v1 Total** | | **~10 days** | |
| v2: RBAC + Escalation + Range | P9, P10, P11 | 3 days | High |
| v2: Frontend v2 | P12 | 3 days | Medium |
| **v2 Total** | | **~6 days** | |
| v3: Save card + Performance + Scaffold | P13–P16 | 4 days | Medium |
| **v3 Total** | | **~4 days** | |
| v4: Gateway + Modular refactor | P17–P24 | 6 days | Medium |
| **v4 Total** | | **~6 days** | |
| v5: Agentic (Magenta integration) | P25, P26 | 3 days | Low (API stability TBD) |
| **v5 Total** | | **~3 days** | |

---

## ADR-001: Application-side joins instead of `$lookup`

**Date:** 2026-05-26  
**Status:** Accepted

**Context:** The demo needs to combine data from `customerAgreement`, `cardTransaction`, and `fraudDiagnosisCase` in a single case detail response. The natural MongoDB approach would be `$lookup`.

**Decision:** Use application-side sequential queries. The backend service fetches each collection independently and assembles the response object in TypeScript.

**Consequences:**  
+ Compatible with QE: `$lookup` targeting QE collections is not currently supported by the MongoDB QE driver for encrypted fields.  
+ Explicit join logic is easier to control with RBAC (skip the sensitive collection query entirely for Level 1).  
- Slightly more network round-trips to Atlas per request (2–3 sequential queries vs. one aggregation). Acceptable under demo load on M10.

---

## ADR-002: Two DEKs (lookup + sensitive) instead of per-collection DEKs

**Date:** 2026-05-26  
**Status:** Accepted

**Context:** QE requires a DEK per encrypted field (or shared DEK across fields). Options: one global DEK, two DEKs, or one DEK per collection.

**Decision:** Two DEKs: `DEK-lookup` for searchable collections (`cardTransaction`, `customerAgreement`, `paymentCard`, `partyAuthentication`), `DEK-sensitive` for non-searchable sensitive collections.

**Consequences:**  
+ Maps clearly onto the access-control boundary (Level 1 vs Level 2).  
+ Simple to explain in the demo: "lookup key" vs. "sensitive key."  
- Rotating `DEK-lookup` re-encrypts all four lookup collections simultaneously: acceptable for a demo.  
- In production, one DEK per collection is recommended for finer-grained rotation control. This recommendation is documented in the technical spec.

---

## ADR-003: Payment token stored as plaintext, not QE equality

**Date:** 2026-05-27  
**Status:** Accepted

**Context:** The initial design placed `paymentCardReference` (the payment token) under QE equality encryption, treating it as CHD (Cardholder Data). An expert review identified this as technically incorrect.

**Decision:** `paymentCardReference` is stored as a plaintext field and searched via a standard MongoDB index. It is explicitly excluded from the `encryptedFieldsMap`.

**Rationale:** Under PCI DSS v4.0, a properly implemented payment token is a surrogate for the PAN. A token that meets the standard's requirements (irreversible, or reversible only through a controlled vault with additional authentication factors) is **not classified as CHD**. Encrypting a non-sensitive field with QE and presenting that as a PCI requirement would mislead technically sophisticated audiences (QSAs, security architects, FSI prospects) and misrepresent the standard.

The correct story is: encrypt what the standard requires, nothing more. QE equality protects genuine PII/CHD fields (`customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`). The token's plaintext storage demonstrates scope precision, which is itself a positive QSA talking point.

**Consequences:**  
+ Demo is technically accurate and defensible in expert QSA reviews.  
+ Standard index on `paymentCardReference` is simpler and faster than QE equality.  
+ Removes a distraction from the QE story: the audience focuses on fields that genuinely require encryption.  
- A reviewer who has not read the PCI DSS standard may initially question why a card-related field is plaintext. This is addressed with the explicit presenter note in `demo-simulator.md` and the Q&A entry in `docs/q&a.md`.

---

## ADR-004: Dual-mode frontend (Simulator + Application)

**Date:** 2026-05-27  
**Status:** Accepted

**Context:** IST demos need to work both as presenter-led narrated walkthroughs (no audience login required) and as interactive application demonstrations (full login, role-based routing, JWT). A single mode forces a choice between ease of presentation and realism.

**Decision:** The frontend supports two distinct modes selectable from the landing page:

- **Simulator Mode:** No login. Story-driven, presenter-controlled. Each step is a scripted screen with talking points. The "Encrypted in Atlas" toggle calls the raw document endpoint (`GET /api/v1/system/raw/:collection/:id`) via a plain MongoClient to show actual ciphertext. Suitable for conference demos, screen recordings, and low-bandwidth environments.
- **Application Mode:** Full JWT login via the pre-seeded user selector. Role-based routing: customer → payment flow; Level 1 Analyst → investigation dashboard; Level 2 Investigator → escalation workflow; Auditor → audit trail. Suitable for hands-on prospect workshops and guided evaluations.

Both modes connect to the same Fastify API and the same Atlas cluster. The mode selection is a frontend routing concern only: no backend changes required.

**Consequences:**  
+ Presenter can choose the appropriate mode for the audience.  
+ Simulator mode degrades gracefully without Atlas connectivity for the raw doc toggle (shows a static ciphertext snippet as fallback).  
+ Application mode demonstrates a realistic auth + RBAC flow end-to-end.  
- Two frontend entrypoints (`/simulator/*` and `/demo/*`) require distinct route trees in the App Router.

---

## ADR-005: Case Notes as Append-Only Events (Ch-03)

**Date:** 2026-06-10  
**Status:** Accepted

### Context

Notes were stored as two mutable string fields directly on the `fraudDiagnosisCase` document:

- `fraudDiagnosisCaseNotes?: string` — internal analyst note, overwritable
- `fraudDiagnosisCustomerSubjectNotes?: string` — customer-visible note, overwritable

This design had four compounding problems:

1. **Overwrite destroys history.** Any `PATCH` to either field silently discards the previous content. BIAN SD-83 mandates an append-only principle for case records: case state transitions and communications must be preserved in full.
2. **Unbounded-array anti-pattern risk.** If notes were migrated to arrays on the case document they would grow without bound and bloat the primary document over time, a known MongoDB anti-pattern for high-volume subdocument growth.
3. **PCI DSS Req 10.3 audit-log integrity.** PCI DSS v4.0 Requirement 10.3 requires that audit-log records cannot be altered or deleted. Storing notes as mutable fields on the case document allows any write to bypass that guarantee.
4. **Customer visibility.** With a single mutable field the customer saw only the most recent note, never the full communication history.

### Decision

Notes are stored as discrete events in the **`fraudDiagnosisCaseEvents`** collection — the same collection already used for all case audit events (status changes, escalations, assignments). Each note event is an immutable document with the following fields:

| Field | Type | Description |
|---|---|---|
| `noteId` | `string` | UUID assigned at creation; stable reference for retraction |
| `noteText` | `string` | Immutable content of the note |
| `visibility` | `'internal' \| 'customer'` | Controls which roles receive the note in API responses |
| `actionType` | `'note_added' \| 'note_retracted'` | Event discriminator, shared with existing event schema |
| `performedByRole` | `UserRole` | Role of the actor who created or retracted the note |
| `actionDateTime` | `Date` | Immutable creation timestamp |

**Error correction without physical delete:** A note error is corrected by appending a `note_retracted` event that references the original `noteId`. No document is updated or removed. The event log remains complete. Only the role that authored the original `note_added` event may append its retraction (enforced in the service layer).

**Deprecated fields:** `fraudDiagnosisCaseNotes` and `fraudDiagnosisCustomerSubjectNotes` are deprecated on the `fraudDiagnosisCase` document. They are retained as read-only for legacy seed data. Any API write that targets these fields is rejected with HTTP 400.

**New API surface (3 endpoints):**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/fraud/:id/notes` | Add a `note_added` event; body: `{ noteText, visibility }` |
| `DELETE` | `/api/v1/fraud/:id/notes/:noteId` | Append a `note_retracted` event; no physical delete |
| `GET` | `/api/v1/transactions/:id/notes` | Return `notes: NoteEntry[]` — all non-retracted notes for the linked case, filtered by the caller's role |

### Consequences

+ **Full audit trail** — every note creation and retraction is a permanent event; satisfies PCI DSS Req 10.3.  
+ **Customer communication history** — `GET /transactions/:id/notes` returns a chronological list of `visibility: 'customer'` notes rather than a single overwritten string.  
+ **Consistent event model** — notes reuse the existing `fraudDiagnosisCaseEvents` schema and indexes; no new collection required.  
+ **Role-based retraction** — the constraint that only the authoring role can retract a note is enforced in the service layer, not by a database-level ACL, keeping the enforcement explicit and testable.  
- The deprecated string fields must be preserved on the document interface (as optional) to avoid breaking seed-data reads until a future migration removes them.  
- The `DELETE /fraud/:id/notes/:noteId` route performs a logical delete (append), which may surprise consumers expecting a 204 with no body; the response shape must be clearly documented in `technical-spec.md §6`.

---

## ADR-006: Payment Gateway Integration - Redirect Checkout + Payment Links (Ch-04)

**Date:** 2026-06-10
**Status:** Accepted

### Context

The existing demo simulates payment transactions from the customer's perspective: the customer fills a form, the API creates a `cardTransactionLog` document, and a fraud case is optionally opened. This is a closed loop that only demonstrates the data and encryption model.

The request was to extend the system to allow **external merchants** to integrate payment collection into their own systems — a fundamental capability of any real PSP. The goal: maximum ease of integration for external merchants, minimum PCI DSS scope for those merchants.

This ADR documents the study of four integration patterns and the rationale for the selected approach.

### Integration Methods Compared

#### Method A: Redirect Checkout (Hosted Payment Page)

The merchant's backend creates a checkout session via API, then redirects the buyer's browser to a hosted payment page (HPP) on the PSP domain. The buyer enters card details on the PSP's page. After payment the buyer is redirected back to the merchant's `returnUrl`.

**PCI DSS scope for the merchant:** SAQ A — the simplest possible. The merchant's system never touches cardholder data at any point; only the PSP (this system) handles card entry.

**External integration surface (3 steps):**
```javascript
// 1. Merchant creates session
const { paymentPageUrl } = await fetch('/api/v1/checkout/sessions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ amount, currency, returnUrl, cancelUrl, description })
}).then(r => r.json());

// 2. Merchant redirects buyer
res.redirect(paymentPageUrl);

// 3. Merchant verifies result (buyer is sent back to returnUrl)
const session = await fetch(`/api/v1/checkout/sessions/${sessionId}`).then(r => r.json());
// session.checkoutSessionStatus === 'completed'
```

**Used by:** Stripe Checkout, PayPal Checkout, Adyen HPP, Redsys TPV Hosted, PagoOnline, SumUp.

**Session security:** The session is server-side; the URL contains only a UUID. The amount, currency, and returnUrl are stored on the server and cannot be tampered with by a buyer intercepting the URL. Sessions expire after 30 minutes (TTL index).

#### Method B: Payment Links

The merchant creates a shareable URL ahead of time. The URL can be embedded in an email, printed as a QR code, shared on social media, or sent via SMS. No buyer session is required on the merchant side; any buyer who receives the URL can pay.

**PCI DSS scope for the merchant:** SAQ A — same as Method A.

**External integration surface (2 steps):**
```javascript
// 1. Merchant creates link
const { paymentUrl } = await fetch('/api/v1/payment-links', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ amount, currency, description, usageType: 'single_use' })
}).then(r => r.json());

// 2. Merchant shares the URL (email, QR code, etc.)
sendEmail(customerEmail, `Pay here: ${paymentUrl}`);
```

**Key differences from Redirect Checkout:**
- No buyer web session on the merchant side at creation time
- No `returnUrl` — success is shown on the gateway page
- Can be `single_use` (invoice-style) or `multi_use` (store payment button)
- Optional expiry date

**Used by:** Stripe Payment Links, PayPal.me, Square Pay Links, Redsys Link de Pago, Kushki.

#### Method C: Embedded Checkout JS SDK (proposed for v5)

A JavaScript SDK renders a payment form inside an iframe on the merchant's own page. The buyer never leaves the merchant's site; the iframe calls the PSP API directly.

**PCI DSS scope for the merchant:** SAQ A-EP — slightly more complex than A. The merchant's domain loads a third-party script that handles card entry.

**Not implemented in this iteration** because: (1) requires building and hosting a JS SDK bundle; (2) requires CSP and X-Frame-Options configuration; (3) the incremental demo value over Method A is low for a first iteration. Documented here as the recommended v5 enhancement.

#### Method D: API Direct (merchant-side card form + tokenization API)

The merchant builds their own card form, calls a tokenization endpoint to convert the card to a token, then calls the payment API with the token. Requires `libmongocrypt` or equivalent on the merchant's stack.

**PCI DSS scope for the merchant:** SAQ D — the most complex category. The merchant's frontend must be fully PCI DSS compliant because it renders the card form.

**Not implemented and not recommended** for the "easy external integration" goal. SAQ D compliance requires extensive merchant-side controls that negate the integration simplicity goal.

### Decision

**Implement Method A (Redirect Checkout) and Method B (Payment Links) in Ch-04.** Propose Method C (Embedded SDK) for v5. Exclude Method D.

**Rationale:**
1. **SAQ A scope for all external merchants** — no cardholder data ever passes through merchant systems.
2. **Minimal integration surface** — merchants need 1-3 API calls; no SDK, no JavaScript embed required.
3. **Industry standard** — every major payment provider (Stripe, PayPal, Adyen) offers these two patterns as the default recommended integration.
4. **BIAN alignment** — both patterns map naturally onto SD-64 (Payment Order) with distinct Control Record Types (`CheckoutSession` vs. `PaymentLink`).

### BIAN Alignment

| New Collection | BIAN SD | Control Record Type | Purpose |
|---|---|---|---|
| `checkoutSessionLog` | SD-64 Payment Order | `CheckoutSessionLog` | Hosted payment page session (Method A) |
| `paymentLinkRecord` | SD-64 Payment Order | `PaymentLinkRecord` | Pre-configured shareable payment invitation (Method B) |
| `paymentOrderProcedure` | SD-64 Payment Order | `PaymentOrderProcedure` | Full payment intent lifecycle (confirm → authorize → capture) |
| `cardEtokenProcedure` | SD-57 Card eToken | `CardEtokenProcedure` | Card token references and network tokens (v5 stub) |
| `merchantAgreementProcedure` | SD-89 Merchant Relations | `MerchantAgreementProcedure` | Existing stub converted to full MongoDB persistence |

> **BIAN Audit 2026-06-10 (D-21–D-30):** All `bianControlRecordType` values now match the collection name suffix (e.g., `CheckoutSessionLog`, `PaymentLinkRecord`). `bianServiceDomain` values use BIAN standard spacing (`'Payment Order'`, `'Card eToken'`). `MerchantAgreementStatus` expanded to full BIAN Agreement lifecycle (`initiated | agreed | active | amended | suspended | closed`). Collection constants updated: `paymentOrder` → `paymentOrderProcedure`, `tokenVault` → `cardEtokenProcedure`.

Both `checkoutSessionLog` and `paymentLinkRecord` use SD-64 because in BIAN terms a checkout session and a payment link are both forms of **payment order initiation** — the SD-64 Control Record captures the payment amount, currency, and status lifecycle regardless of how the buyer arrived at the payment form.

#### Dual-role: Natural Person as Customer AND Merchant (BIAN-validated)

A `Party` (SD-13) can simultaneously be the subject of a `CustomerAgreement` (SD-53) and the owner of a `MerchantAgreement` (SD-89). This is fully aligned with the BIAN Business Object Model: `Party` is the identity anchor; `CustomerAgreement` and `MerchantAgreement` are role-scoped contracts linked back to the Party via `partyInstanceReference`.

The correct cross-domain FK is `merchantOwnerPartyReference → party.partyInstanceReference` (NOT a reference to `customerAgreementInstanceReference` — that would conflate identity with a role-scoped contract). A `Party` may own zero or more merchant agreements without having a customer agreement at all, and vice versa. KYC verification (performed once on the `Party`) is shared across all roles.

### Security Model

| Concern | Solution |
|---|---|
| Session amount/returnUrl cannot be tampered | Stored server-side; URL contains only UUID |
| Session expiry | TTL index on `checkoutSessionExpiresAt` (30 min) |
| Payment link expiry | TTL index on `paymentLinkExpiresAt` (optional, sparse) |
| Single-use link enforcement | `status = 'completed'` after first payment; subsequent `POST /pay` returns 410 |
| Merchant API key storage | bcrypt hash in DB; plaintext returned only once on key generation |
| Webhook authenticity (merchant receiving) | `X-Webhook-Signature: sha256=<hmac(payload, webhookSecret)>` — mirrors Stripe/GitHub pattern |
| Card data isolation | Raw card numbers never sent to or stored by the API; client-side tokenization (`pm_<random>`) |
| PCI DSS SAQ A | The hosted payment pages (`/checkout/*`, `/pay/*`) are on the PSP domain; buyers enter card details only on those pages |

### API Key Design

Format: `lbpk_live_<32 random hex characters>` (44 chars total)

The prefix `lbpk` identifies LeafyBank Payment Key, `live` distinguishes production from `test` environment keys. Only the first 8 characters (`keyPrefix`) are stored in plaintext for display purposes. The rest of the key is stored as a bcrypt hash. The plaintext key is returned exactly once, on key generation.

### New Collections

Two new MongoDB collections, both plaintext (no QE — neither contains CHD or PII at rest):

**`checkoutSessionLog`** — TTL-indexed on `checkoutSessionExpiresAt`. Each document represents one checkout session with its full lifecycle from `pending` to `completed | expired | cancelled`.

**`paymentLinkRecord`** — uniquely indexed on `paymentLinkCode`. Supports both `single_use` and `multi_use` links. TTL index on `paymentLinkExpiresAt` (sparse — only applies to links with explicit expiry).

### Consequences

+ External merchants can integrate in minutes with a 3-step API call (create session, redirect, verify).
+ Payment links require no buyer session on the merchant side — suitable for invoices, QR codes, and social commerce.
+ Both patterns deliver SAQ A scope, the lowest PCI DSS compliance burden, to integrated merchants.
+ Webhook delivery gives merchants real-time notification without polling.
+ The gateway's core QE story is preserved: checkout and payment link services ultimately call `cardTransaction.service.createTransaction()`, so all card transactions go through the existing QE-protected `cardTransactionLog` collection.
- Checkout sessions add a MongoDB write per payment attempt (TTL-expired sessions accumulate but are auto-deleted by the TTL index).
- Payment link codes require collision-checking on generation (low probability with 8 alphanumeric chars = 36^8 space, but worth retrying on insert conflict).
- Webhook delivery is best-effort in this demo (3 attempts with exponential backoff). A production system would require a persistent delivery queue (e.g., MongoDB change stream + worker).

---

## ADR-007: Merchant Onboarding Lifecycle (SD-89 — Ch-05)

**Date:** 2026-06-10  
**Status:** Accepted

### Context

ADR-006 established `merchantAgreementProcedure` (SD-89) as a fully MongoDB-backed collection and introduced the dual-role Party pattern. However, Ch-04 seeds all merchants with `status: 'active'` from inception, bypassing the regulated onboarding lifecycle entirely. This omission makes the demo incomplete in two ways:

1. **BIAN SD-89 defines a multi-step Agreement lifecycle.** `MerchantAgreementProcedure` uses Behavior Qualifier type **Agreement** with canonical states: `initiated → under_review → agreed → active`, plus `amended`, `suspended`, `rejected`, and `closed`. The demo showing only `active` merchants is architecturally misleading to financial architects.

2. **KYB (Know Your Business) is a regulated obligation.** Any payment institution accepting merchant funds must perform entity-level due diligence before activating payment capability. PCI DSS Req 12.8 requires documented agreements with all entities that handle or could affect card data security. Without a review step, the demo cannot illustrate the compliance lifecycle.

3. **No internal review role exists.** Approving or rejecting a merchant application is the responsibility of a Merchant Acquiring department employee — a different BIAN actor from a fraud investigator (SD-83), security auditor (SD-116), or customer (SD-53). A new role `merchant_officer` is required.

### Decision

**Add the complete BIAN SD-89 merchant onboarding lifecycle with `merchant_officer` review capability.**

#### BIAN Action Term Mapping

| Actor | BIAN Action Term | Outcome | HTTP Method |
|---|---|---|---|
| Customer | `Initiate` | Creates `MerchantAgreementProcedure` at `under_review` | `POST /api/v1/merchants` |
| Merchant Officer | `Control` (approve) | Transitions to `agreed`, populates review metadata | `PATCH /api/v1/merchants/:id/review` |
| Merchant Officer | `Control` (reject) | Transitions to `rejected`, populates review metadata | `PATCH /api/v1/merchants/:id/review` |
| Merchant | `Update` | Amends terms (future: `PATCH /api/v1/merchants/:id`) | — |
| Bank System | `Terminate` | Transitions to `closed` | — |

The `Control` Action Term is used because it represents a **state change of the Control Record** — the officer is controlling whether the agreement proceeds. This is the correct BIAN term for approval/rejection workflows, not `Update` (which modifies data fields) and not `Execute` (which runs a step in a process).

#### New Role: `merchant_officer`

`merchant_officer` maps to a BIAN `Party` (SD-13) with `partyType: 'employee'` and a `CustomerAuthenticationAssessment` (SD-91) role claim of `merchant_officer`. The officer belongs to the "Merchant Acquiring" department of the bank.

**Why not reuse `security_auditor`?**
- `security_auditor` maps to SD-116 (IT Systems Management / Compliance) — responsible for audit logs and access events.
- `merchant_officer` maps to SD-89 (Merchant Relations) — responsible for merchant commercial agreements.
- Conflating these roles violates the BIAN principle of single-responsibility per Service Domain actor. Least-privilege (PCI DSS Req 7.1) also requires separation.

#### KYB Process (Simplified for Demo)

KYB is modelled as a Behavior Qualifier type `Step` within SD-89 (BQ: `KYBAssessment`). In the demo it is a manual review by the `merchant_officer`. In production, KYB would invoke SD-132 (Regulatory Compliance) with automated checks (business registry lookup, sanctions screening, adverse media). The demo omits automated KYB to keep the scope focused on the MongoDB and encryption story.

> **Ch-06 update (ADR-008)**: KYB is now persisted as a proper BIAN BQ:Step sub-document `merchantAgreementKybCheck` on the `MerchantAgreementControlRecord`. The BIAN-canonical status vocabulary (`initiated | verified | rejected | expired`) replaces ad-hoc review notes. See ADR-008 for the full design.

#### Full `MerchantAgreementStatus` Lifecycle

```
initiated       ← customer submits application (Initiate)
    ↓
under_review    ← merchant_officer begins KYB (Control: started)
    ↓
agreed          ← KYB passed; T&C presented (Control: approve)
    ↓
active          ← T&C accepted; API key issued; payments enabled
    ↓
amended         ← terms updated (Update)
suspended       ← fraud hold or compliance flag
closed          ← agreement terminated (Terminate)

under_review → rejected  ← KYB failed (Control: reject)
```

#### New Review Metadata Fields on `MerchantAgreementControlRecord`

```typescript
// Top-level fields (backward-compat from Ch-05):
merchantReviewNote?: string;                     // Officer's audit comment
merchantReviewedByPartyReference?: string;       // FK → party.partyInstanceReference (SD-13)
merchantReviewedDateTime?: Date;                 // ISO timestamp of review decision

// Ch-06 — BQ:Step sub-document (authoritative KYB record):
merchantAgreementKybCheck?: {
  merchantAgreementKybCheckStatus: 'initiated' | 'verified' | 'rejected' | 'expired';
  merchantAgreementKybCheckCompletedDate?: Date;
  merchantAgreementKybCheckReference?: string;  // Trade register / AML screening reference
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;  // FK → party (reviewing officer)
};
```

### BIAN Alignment

| Concept | BIAN Reference | Implementation |
|---|---|---|
| SD-89 Merchant Relations | `MerchantAgreementProcedure` Control Record | `merchantAgreementProcedure` collection |
| `Initiate` Action Term | Customer submits application | `POST /api/v1/merchants` → `under_review`; KYB set to `initiated` |
| `Control` Action Term | Officer approves or rejects | `PATCH /api/v1/merchants/:id/review` |
| `merchant_officer` Party | SD-13 `partyType: 'employee'` | Seeded as PTY-056 (Rachel Torres) |
| KYB as BQ:Step | SD-89 BQ type: Step | `merchantAgreementKybCheck` sub-document with BIAN status vocabulary |
| Dual-role pattern | SD-13 Party anchor (ADR-006) | `merchantOwnerPartyReference → party.partyInstanceReference` |

### PCI DSS Alignment

| Requirement | Mapping |
|---|---|
| Req 7.1 (Least privilege) | `merchant_officer` is the only role that can call `PATCH /merchants/:id/review`; customer cannot self-approve |
| Req 8.1 (User accounts) | `merchant_officer` has a distinct auth record in `customerAuthenticationProcedure` (SD-91) |
| Req 12.8 (Merchant agreements) | The `MerchantAgreementProcedure` document is the formal agreement record; `merchantAgreementKybCheck.merchantAgreementKybCheckPerformedByPartyReference` links to the approving officer for audit |
| Req 12.8.3 (Due diligence documentation) | `merchantAgreementKybCheckReference` stores the external trade register / AML screening reference |

### Consequences

+ Demo tells a realistic, end-to-end merchant onboarding story that FSI architects recognise.
+ `merchant_officer` introduces a new role that showcases RBAC on a BIAN-specific Action Term boundary.
+ Seed data includes an `under_review` merchant — the officer can approve live during the demo for a "before/after" effect.
+ Webhook event `merchant.agreement.activated` demonstrates the event-driven integration pattern.
- Adds a new frontend route (`/system/merchant/review`) and a new role to the auth model.
- Seed complexity increases: `parties.json`, `customerAuthentications.json`, and `merchants.json` all require new entries.

---

## ADR-008: Debug Mode Architecture (Ch-05)

**Date:** 2026-06-10  
**Status:** Accepted

### Context

The demo currently operates in one mode: a clean business narrative suitable for a general audience. However, the primary target buyers — CISO / Security Architects and MongoDB SEs — need technical depth to evaluate Queryable Encryption, BIAN alignment, and PCI DSS compliance. Without a way to show the raw MongoDB documents (with ciphertext), BIAN Service Domain annotations, and PCI DSS requirement citations directly in the UI, presenters must switch to external tools (Atlas Data Explorer, terminal) and break the demo narrative.

The existing Simulator Mode has a raw document toggle for the encryption visual, but it is limited to one step and one collection. Application Mode has no technical overlays at all.

### Decision

**Introduce Debug Mode: a global UI toggle that adds technical deep-dive overlays across all Application Mode pages.**

Debug Mode is a **demo-only feature** and must not be enabled in any production or staging environment. It is guarded by the `DEMO_DEBUG_ENABLED=true` environment variable. If the env var is absent or false, the toggle button is not rendered and no debug components are mounted.

#### Architecture

```
frontend/src/
  context/
    DebugContext.tsx          — React context + useDebugMode() hook
  components/debug/
    DebugBadge.tsx            — BIAN SD chip + PCI DSS requirement badge
    DebugInfo.tsx             — Expandable info panel (BIAN Action Term, HTTP, MongoDB op, PCI control)
    DebugRawDoc.tsx           — Live MongoDB document viewer (calls /api/v1/system/raw/)
    DebugFieldLabel.tsx       — Field wrapper: QE mode + PCI classification
```

**`DebugContext`** wraps the entire `layout.tsx`. It reads `process.env.NEXT_PUBLIC_DEMO_DEBUG_ENABLED` at build time and `localStorage.demo_debug_mode` at runtime.

**`useDebugMode()` hook returns:**
```typescript
{
  debugMode: boolean;        // current toggle state
  toggleDebug: () => void;   // toggle and persist to localStorage
  debugEnabled: boolean;     // true only when NEXT_PUBLIC_DEMO_DEBUG_ENABLED=true
}
```

#### Debug Overlays Specification

| Component | Trigger | Content |
|---|---|---|
| `DebugBadge` | Any entity card | BIAN Service Domain chip (e.g., `SD-89 · Merchant Relations`) + collection name chip |
| `DebugBadge` | Any encrypted field | `PCI DSS Req 3.5.1` badge |
| `DebugFieldLabel` | Form/display fields | `QE:equality`, `QE:none`, or `unencrypted` tag; lock icon for encrypted |
| Lock Tooltip | Encrypted fields | `"Stored as BSON Binary subtype 6 — MongoDB Atlas server never decrypts this field"` |
| `DebugInfo` | Every action button | BIAN Action Term · HTTP method · MongoDB write op · PCI DSS control reference · Business logic description |
| `DebugRawDoc` | Merchant, Transaction, Case pages | Live MongoDB document panel; `GET /api/v1/system/raw/:collection/:id`; formatted JSON with Binary notation |

#### Raw Document Viewer (`DebugRawDoc`)

Reuses the same `/api/v1/system/raw/:collection/:id` endpoint already in production for Simulator Mode. The endpoint returns documents with a standard MongoDB driver (bypassing the QE-enabled client), so encrypted fields appear as BSON Binary objects. The component:
- Renders the document as formatted JSON with syntax highlighting.
- Replaces Binary values with a readable notation: `Binary('hex...', 6)`.
- Shows a "Refresh" button (re-fetches on demand).
- Shows a copy-to-clipboard icon.
- Never exposes credentials or connection strings.

#### Login Cards (Debug Mode)

When debug mode is ON, the login screen replaces the credential form with a grid of user cards — one per demo user. Each card:
- Shows the user's **name**, **role badge** (color-coded), **department**, and a **"Log in"** button.
- In debug mode: also shows `partyInstanceReference` (SD-13) and `customerAuthenticationInstanceReference` (SD-91).
- One click authenticates via the existing `POST /api/v1/auth/login` endpoint with the user's pre-configured credentials (no manual entry required in debug mode).

Role badge color mapping:

| Role | Color |
|---|---|
| `customer` | Blue |
| `level1_analyst` | Amber |
| `level2_investigator` | Orange |
| `security_auditor` | Red |
| `merchant_officer` | Purple |

#### Form Presets (Debug Mode)

Each form in the application has a "Load test data" dropdown (visible only in debug mode) with 2–3 realistic presets. Selecting a preset fills all form fields instantly. This eliminates manual data entry during live demos.

Example presets for the Merchant Application Form:

| Preset | Business Name | MCC | Monthly Volume | Entity Type |
|---|---|---|---|---|
| Freelancer | "Ana Reyes Consulting" | 7392 (Management Consulting) | $8,000 | Sole Proprietorship |
| Online Store | "CubaShop Digital" | 5999 (General Merchandise) | $25,000 | LLC |
| Restaurant | "Espresso Works Ltd" | 5812 (Eating Places) | $15,000 | LLC |

### PCI DSS Alignment

Debug Mode access to raw MongoDB documents requires careful scoping:
- The `/api/v1/system/raw/` endpoint requires a valid JWT. No unauthenticated access.
- Raw documents show **encrypted** field values (ciphertext) — not decrypted PAN or PII.
- The `DEMO_DEBUG_ENABLED` environment variable ensures this feature can never accidentally be enabled in a production deployment (missing env var = feature absent at build time).

### Consequences

+ Presenters can demonstrate the full QE technical story (ciphertext visible, BIAN SD labels, PCI DSS citations) without leaving the UI.
+ Debug Mode is self-contained — it can be turned off for a business audience without any code change.
+ Form presets eliminate typing errors during live demos.
+ Login cards make role-switching instant for workshop scenarios.
- Adds ~5 new React components and a context provider to the frontend.
- `NEXT_PUBLIC_DEMO_DEBUG_ENABLED` must be added to the `.env.local` template and deployment docs.
- The raw document viewer introduces a dependency on the Simulator Mode `/system/raw` endpoint — any changes to that endpoint must be backward compatible.

---

## ADR-009: KYC (SD-53) and KYB (SD-89) as BIAN BQ:Step Sub-Documents (Ch-06)

**Date:** 2026-06-10  
**Status:** Accepted

### Context

Prior to Ch-06, the demo had no formal representation of the Know Your Customer (KYC) or Know Your Business (KYB) compliance checks:

- **KYC (SD-53)**: `CustomerAgreementControlRecord` had no identity-verification fields. The fact that a customer had passed KYC was implicit (they existed in the system). There was no way to demonstrate KYC lifecycle states (`initiated`, `verified`, `expired`) or link to an AML screening reference.
- **KYB (SD-89)**: `MerchantAgreementControlRecord` had three loose top-level fields (`merchantReviewNote`, `merchantReviewedByPartyReference`, `merchantReviewedDateTime`) added in Ch-05. These captured the outcome but violated BIAN naming conventions (no BQ prefix) and used ad-hoc vocabulary (`passed/failed` implied) rather than the BIAN lifecycle terms.

Neither representation could be shown to FSI architects as "BIAN-aligned" without qualification. For a demo targeting compliance architects and CISO roles, the absence of formal KYC/KYB structures is a significant gap.

### Decision

**Model both KYC and KYB as BIAN Behavior Qualifier type Step (BQ:Step) sub-documents**, following the BIAN Service Domain specifications for SD-53 and SD-89 respectively.

#### BIAN Design Rationale

The BIAN Business Object Model defines **Behavior Qualifier** as a typed attribute of a Control Record. BQ type **Step** represents a sequential step within a procedure. Both KYC (identity check during customer onboarding) and KYB (business verification during merchant onboarding) are canonical BQ:Step instances:

```
SD-53 CustomerAgreementProcedure (Control Record)
  └── BQ:Step  customerAgreementKycCheck      ← NEW Ch-06
        customerAgreementKycCheckStatus       initiated | verified | rejected | expired
        customerAgreementKycCheckCompletedDate
        customerAgreementKycCheckReference    (AML / document check reference)
        customerAgreementKycCheckNotes

SD-89 MerchantAgreementProcedure (Control Record)
  └── BQ:Step  merchantAgreementKybCheck      ← Ch-05 formalized in Ch-06
        merchantAgreementKybCheckStatus       initiated | verified | rejected | expired
        merchantAgreementKybCheckCompletedDate
        merchantAgreementKybCheckReference    (trade register / AML reference)
        merchantAgreementKybCheckNotes
        merchantAgreementKybCheckPerformedByPartyReference
```

**Why not a flat field on the Control Record?**

BIAN mandates that every attribute in a BQ namespace carries the BQ name as a prefix. A flat `kycStatus` field would violate this rule and conflate the step's lifecycle with the agreement's lifecycle. The sub-document boundary makes the scope explicit.

**Why not a separate collection?**

KYC and KYB are integral steps of their respective procedures — they do not exist independently. A separate collection would introduce an unnecessary join, add seed complexity, and contradict the BIAN model where BQ:Step is an attribute of the CR, not a standalone entity.

**Why not store in SD-13 Party?**

SD-13 (Party Data Management) is the identity anchor — it stores WHO the party is (name, address, contact). KYC status is a COMPLIANCE OUTCOME of the agreement procedure, not a property of the identity. Placing it in Party would conflate identity management with compliance lifecycle — a BIAN anti-pattern. The correct owner is the SD that runs the procedure that includes the check.

#### BIAN Status Vocabulary

Both checks use the same four-value lifecycle: `initiated | verified | rejected | expired`.

| Status | Meaning |
|---|---|
| `initiated` | Check started; awaiting outcome (onboarding in progress) |
| `verified` | Check passed; identity / business verified |
| `rejected` | Check failed; application denied |
| `expired` | Check passed but is no longer valid (time-based renewal required) |

Note: `passed` and `failed` are **not** used — they are not BIAN vocabulary. The correct terms are `verified` and `rejected`.

#### BIAN Naming Convention

Every field in a BQ sub-document must include the BQ name as a prefix:
- Correct: `customerAgreementKycCheckStatus`
- Incorrect: `kycStatus`, `kycCheckStatus`, `customerAgreementKycStatus`

This rule ensures BQ fields remain unambiguous when the Control Record is serialised and when queried in Atlas.

### Implementation

#### `createMerchant()` — KYB initiated at submission

```typescript
merchantAgreementKybCheck: {
  merchantAgreementKybCheckStatus: 'initiated',
} satisfies MerchantAgreementKybCheck,
```

#### `reviewMerchantApplication()` — Dual-write on review (backward compat + BQ:Step)

```typescript
const kybStatus: KybCheckStatus = action === 'approve' ? 'verified' : 'rejected';

// In $set:
merchantAgreementKybCheck: {
  merchantAgreementKybCheckStatus: kybStatus,
  merchantAgreementKybCheckCompletedDate: now,
  merchantAgreementKybCheckNotes: reviewNote ?? '',
  merchantAgreementKybCheckPerformedByPartyReference: reviewerPartyRef,
} satisfies MerchantAgreementKybCheck,
// Top-level legacy fields also written for backward compat
merchantReviewNote: reviewNote ?? '',
merchantReviewedByPartyReference: reviewerPartyRef,
merchantReviewedDateTime: now,
```

#### Seed data strategy

| Collection | schemaVersion | KYC/KYB field |
|---|---|---|
| `customerAgreementProcedure` | 3 | All 50 records — 48 `verified`, 1 `expired`, 1 `initiated` |
| `merchantAgreementProcedure` | 2 | All 3 records — 2 `verified`, 1 `initiated` |

### BIAN Alignment

| Concept | BIAN Reference | Implementation |
|---|---|---|
| KYC BQ:Step | SD-53 Behavior Qualifier type Step | `customerAgreementKycCheck` sub-document |
| KYB BQ:Step | SD-89 Behavior Qualifier type Step | `merchantAgreementKybCheck` sub-document |
| BQ naming rule | BIAN BQ field prefix convention | All fields prefixed `customerAgreementKycCheck*` / `merchantAgreementKybCheck*` |
| Status vocabulary | BIAN lifecycle terms | `initiated | verified | rejected | expired` (not `pending/passed/failed`) |

### PCI DSS Alignment

| Requirement | Mapping |
|---|---|
| Req 8.1 (Unique user ID) | `customerAgreementKycCheck` documents the identity verification step that establishes a unique, verified customer identity |
| Req 12.8 (Merchant agreements) | `merchantAgreementKybCheck` is the formal documented evidence of KYB due diligence per merchant |
| Req 12.8.3 (Due diligence) | `merchantAgreementKybCheckReference` stores the external trade register / AML screening reference as audit evidence |

### Consequences

+ Demo can now show KYC and KYB status to FSI architects with full BIAN citation — no more informal notes.
+ Frontend can render color-coded compliance pills (verified=green, initiated=amber, rejected=red, expired=orange).
+ The BIAN audit trail is complete: who performed the check (`merchantAgreementKybCheckPerformedByPartyReference`), when (`merchantAgreementKybCheckCompletedDate`), and what reference (`merchantAgreementKybCheckReference`).
+ `expired` status enables future demo scenarios (KYC renewal workflows, risk-based re-verification).
- `schemaVersion` bumped on both collections — seed re-seeding required to align existing data.
- Top-level review fields (`merchantReviewNote` etc.) are retained for backward compat but are now secondary to the BQ:Step sub-document.

---

## ADR-010 — Internal-First Integration Pattern

**Date:** 2026-06-10  
**Status:** Accepted  
**Iteration:** v6  
**Deciders:** Antonio Membrides Espinosa

### Context

The demo is a fully self-contained system. All compliance functions (fraud scoring, sanctions screening, KYC/KYB verification, AML monitoring, credit bureau checks) are implemented internally. An FSI architect evaluating the system needs to understand how it would connect to their existing compliance stack (Refinitiv, FICO, Onfido, NICE Actimize, Equifax, etc.).

Two approaches were considered:

**Option A — External-only**: Require external provider credentials to make compliance functions work. Realistic, but the demo breaks without configuration. Poor first-impression for offline or air-gapped demos.

**Option B — Internal-First (chosen)**: Ship working internal implementations for every compliance function. External providers are optional overrides registered in the integration registry. When an external provider is configured and active, it takes precedence. When not configured, the internal default runs. The system is never broken.

### Decision

Adopt the **Internal-First integration pattern** for all six compliance integration types:

| Integration type | Internal default | Trigger event | Mode |
|---|---|---|---|
| `fraud_detection` | `fraudDiagnosis.internalFraudScoring` | `transaction.authorized` | sync |
| `hrp_sanctions` | `fraudDiagnosis.hrpcCheck` (existing HRPC endpoint) | `case.created`, `merchant.application.submitted` | sync |
| `kyc_identity` | `customerAgreementKycCheck` BQ:Step status | `kyc.initiated` | async |
| `kyb_business` | `merchantAgreementKybCheck` BQ:Step status | `kyb.initiated` | async |
| `aml_monitoring` | Suspicious pattern analysis stub | `transaction.batch.processed`, `case.escalated` | async |
| `credit_bureau` | `customerCreditRatingState` collection read | `case.created` | sync |

**Routing rule**: For each integration event, the dispatch service checks whether an active external provider is registered for the event type. If yes, dispatch outbound (HTTP or SDK). If no, invoke the internal handler. Both paths log an `IntegrationEvent` record for audit.

**Internal providers are pre-seeded** in `integrationRegistry` with `externalProviderIsInternal: true`. They cannot be suspended via the API. They are displayed in the admin portal with a "Built-in" badge.

### Rationale

- **Demo reliability**: works offline, in air-gapped environments, and without any external credentials.
- **Proof of concept**: shows FSI architects that the plumbing exists — they can swap in their vendor by registering a provider.
- **PCI DSS Req 12.8**: every integration (including internal ones) is documented in the registry with its BIAN SD and PCI DSS requirement mapping — satisfying the "documented relationships with third-party service providers" requirement for external providers.
- **Preserves existing work**: HRPC endpoint (`GET /fraud/hrpc/check`), KYC/KYB BQ:Step sub-documents, and fraud scoring service are not replaced — they become the default implementations.

### Alternatives Rejected

| Alternative | Reason rejected |
|---|---|
| External-only providers | Demo breaks without credentials; poor offline experience |
| Internal-only (no external path) | Answers "how does MongoDB store fraud data" but not "how does it integrate with my stack" |
| Mock/stub external calls | Misleading; an FSI architect would see through it |

### Consequences

+ Demo is always fully functional without any external configuration.
+ A prospect can register their own FDS/AML/KYC provider in the same demo session and see end-to-end flow.
+ BIAN SD-193 External Provider Arrangements is formally introduced as the registry control record.
+ PCI DSS Req 12.8 audit evidence is automatic for every registered provider.
- A new `integrationRegistry` collection must be seeded and maintained.
- `dispatchIntegration()` adds a call to the critical path for fraud scoring and KYC/KYB initiation.
- Internal handlers must be wrapped behind a `InternalIntegrationHandler` interface to allow future substitution.

---

## ADR-011 — system_admin Role as Business Integration Administrator

**Date:** 2026-06-10  
**Status:** Accepted  
**Iteration:** v6  
**Deciders:** Antonio Membrides Espinosa

### Context

The existing codebase has a devops `admin` controller (`backend/src/modules/admin/controllers/admin.controller.ts`) with 7 endpoints: `POST /admin/login`, `POST /admin/run`, `POST /admin/exec`, `GET /admin/logs` (SSE stream), `GET /admin/system`, `GET /admin/env`, `POST /admin/restart`. This is an infrastructure-management tool for demo operators, not a business user.

The Integration Hub (v6) requires a business role that can:
- Register, configure, and suspend external compliance providers
- Manage API key lifecycle (create, rotate, revoke)
- View the integration event audit log
- Test provider connectivity

This is fundamentally different from devops admin. Conflating the two roles would violate the Separation of Duties principle (PCI DSS Req 7.1) and confuse the demo narrative.

### Decision

Introduce a new application role `system_admin` with the following profile:

| Attribute | Value |
|---|---|
| Role key | `system_admin` |
| Display label | `System Administrator` |
| Avatar color | `bg-slate-600 text-white` |
| Role badge | `bg-slate-500/15 text-slate-300 border-slate-500/30` |
| Login path | `/system` (same as all application roles) |
| Home route after login | `/system/admin` |
| BIAN SD | SD-193 External Provider Arrangements |
| PCI DSS context | Req 12.8 (third-party service provider relationships) |

**What system_admin CAN do:**
- View all integration providers (GET /api/v1/integrations)
- Register a new provider (POST /api/v1/integrations)
- Update provider configuration — endpoint, events, timeout, retry (PATCH /api/v1/integrations/:id)
- Rotate API keys (POST /api/v1/integrations/:id/rotate-key)
- Test provider connectivity (POST /api/v1/integrations/:id/test)
- Suspend external providers (POST /api/v1/integrations/:id/suspend) — internal providers are immutable
- View integration event audit log (GET /api/v1/integrations/:id/events)
- View all fraud cases in read-only mode (same as security_auditor)

**What system_admin CANNOT do:**
- Execute server commands (`/admin/exec`, `/admin/run`)
- Restart the application (`/admin/restart`)
- Modify environment variables (`/admin/env`)
- Approve or reject merchant applications (merchant_officer responsibility)
- Investigate fraud cases (level2_investigator responsibility)
- Update customer profile data (customer responsibility)

### Rationale

- **Separation of Duties**: PCI DSS Req 7.1 requires distinct roles for infrastructure management and business configuration. The devops admin manages servers; the system_admin manages compliance integrations.
- **Demo narrative**: the system_admin persona is the FSI prospect's "compliance technology owner" or "fintech integration manager" — a business role, not a sysadmin.
- **BIAN alignment**: SD-193 External Provider Arrangements defines an "External Provider Arrangements Administrator" role that maps directly to system_admin.
- **Auditability**: every action taken by system_admin is logged in the integration event sub-document with the actor role, enabling PCI DSS Req 10.2 (audit log of all privileged access).

### Consequences

+ Clean demo narrative: prospect sees a business admin configuring integrations, not a developer restarting servers.
+ PCI DSS Req 7.1 (Separation of Duties) is demonstrably satisfied in the demo.
+ system_admin can be shown as the persona that "connects LeafyBank to your existing compliance stack."
- New auth/role infrastructure: `system_admin` must be added to ROLE_LABELS, DEMO_USERS_PASSWORDS, ROLE_AVATAR, ROLE_BADGE, and ROLE_HOME in the frontend layout.
- A new seed record must be added to `customerAuthentications.json` and `parties.json`.

---

## ADR-012 — Integration Registry as BIAN SD-193 External Provider Arrangements

**Date:** 2026-06-10  
**Status:** Accepted  
**Iteration:** v6  
**Deciders:** Antonio Membrides Espinosa

### Context

The Integration Hub requires a persistent store for provider configuration (endpoint, API key hash, trigger events, timeout, retry policy), health state, and event audit log. Several models were considered:

**Option A — Flat JSON config file**: Simple, no DB. No audit trail, no runtime updates, no UI management.

**Option B — Environment variables per provider**: Standard for simple integrations. Doesn't support multiple providers of the same type, has no audit trail, can't be managed by a non-developer.

**Option C — Dedicated MongoDB collection (chosen)**: Full CRUD, runtime updates, API key hashing, health tracking, event audit log sub-document, UI management portal.

The chosen model maps precisely to BIAN SD-193 External Provider Arrangements, which defines:
- **Control Record**: `ExternalProviderArrangement` — the provider registration
- **Behavior Qualifier: Assessment**: health check and connectivity test
- **Behavior Qualifier: Update**: key rotation and configuration change
- **Action Log**: integration event log (dispatch, callback, health check, test)

### Decision

Create a new `integrationRegistry` MongoDB collection implementing BIAN SD-193. The TypeScript model is `ExternalProviderArrangement` (see technical-spec.md §1).

**Key design decisions:**

1. **API key security**: API keys are hashed with bcrypt (cost factor 12) before storage. The plaintext key is returned once at creation (and once after rotation) — never stored, never re-exposed. The `externalProviderApiKeyPrefix` field stores a visible prefix (e.g., `fds_live_...`) for UI identification.

2. **HMAC-based inbound callbacks**: External providers send results to `/webhooks/{type}/{id}/callback`. Every inbound request is validated with `X-Webhook-Signature: sha256=<hmac(body, callbackSecret)>`. The callback secret is stored hashed separately from the API key.

3. **Internal providers are immutable**: The 3 pre-seeded internal providers (`int-internal-fds-001`, `int-internal-hrp-001`, `int-internal-aml-001`) have `externalProviderIsInternal: true`. The `suspendIntegration()` service function rejects calls for internal providers with a 400 error. This ensures the demo always has a working baseline.

4. **Event log with TTL**: Integration events are stored in a separate `integrationEvents` collection with a TTL index of 90 days (`expireAfterSeconds: 7776000`) per PCI DSS Req 10.7 (retain audit logs for at least 90 days online).

5. **Unique constraint**: A compound unique index on `(externalProviderArrangementType, externalProviderApiEndpoint)` with `sparse: true` prevents duplicate registrations of the same provider endpoint for the same integration type.

### BIAN Service Domain Mapping for the Registry

| Integration type | BIAN SD | Control Record Type | PCI DSS Requirements |
|---|---|---|---|
| `fraud_detection` | SD-63 Fraud Evaluation | FraudEvaluationAssessment | Req 10.2.1, Req 12.3.1 |
| `hrp_sanctions` | SD-13 Party Reference Data | PartyReferenceDataDirectoryEntry | Req 12.8.1, Req 12.8.5 |
| `kyc_identity` | SD-53 Customer Agreement | CustomerAgreementProcedure | Req 8.1, Req 12.8.1 |
| `kyb_business` | SD-89 Merchant Relations | MerchantAgreementProcedure | Req 12.8.1, Req 12.8.3 |
| `aml_monitoring` | SD-99 Suspicious Activity Analysis | SuspiciousActivityAnalysisAssessment | Req 10.2.1, Req 12.3.1 |
| `credit_bureau` | SD-83 Customer Credit Rating | CustomerCreditRatingState | Req 12.8.1 |

### PCI DSS Alignment

| PCI DSS Requirement | How the registry satisfies it |
|---|---|
| Req 12.8.1 — Maintain list of all third-party service providers | `integrationRegistry` IS the maintained list; each provider record has name, type, endpoint, and status |
| Req 12.8.2 — Written agreement acknowledging responsibility | `pciDssRequirements` field on each record; `externalProviderArrangementStatus` lifecycle tracks agreement state |
| Req 12.8.3 — Due diligence before engagement | `externalProviderLastHealthCheckAt` + `externalProviderHealthStatus` as documented due diligence evidence |
| Req 12.8.5 — Monitor providers' PCI DSS compliance status | Integration event log with health check events; `externalProviderHealthStatus` updated after each test |
| Req 10.2.1 — Audit log of all system access | Every dispatch, callback, health check, and test fires an `IntegrationEvent` record with timestamp, actor, and outcome |
| Req 10.7 — Retain audit logs for at least 90 days | TTL index on `integrationEvents` collection: `expireAfterSeconds: 7776000` |
| Req 6.3.3 — Protect against known vulnerabilities | bcrypt key hashing prevents credential exposure if DB is compromised |

### Consequences

+ Full BIAN SD-193 citation available for the registry in demo presentations.
+ PCI DSS Req 12.8 compliance evidence is built into the registry schema.
+ External providers can be registered, tested, and activated without any code change or restart.
+ API key security matches industry standard (bcrypt hash, plaintext shown once).
- New collection `integrationRegistry` and `integrationEvents` must be created, indexed, and seeded.
- Dispatch layer adds latency to fraud scoring hot path (~2–5ms for internal dispatch, timeout budget for external).
- HMAC validation requires the callback secret to be stored in hashed form, separate from the API key — adds complexity to the callback controller.

---

## ADR-013 — Multi-Provider Routing Groups

**Date:** 2026-06-10  
**Status:** Proposed  
**Iteration:** v6+  
**Deciders:** Antonio Membrides Espinosa  
**Full design:** [docs/integration-hub-enhancement.md §3.3](integration-hub-enhancement.md)

### Context

ADR-012 established a unique compound index on `(externalProviderArrangementType, externalProviderApiEndpoint)` to prevent duplicate provider registrations. `getActiveProviderForType()` returns exactly one provider. This prevents:
- Registering two fraud detection engines (one real-time, one ML batch) for the same type
- Configuring a fallback AML provider if the primary is unreachable
- Running parallel KYC checks for higher confidence (two providers must both verify)
- Gradually migrating from one provider to another with weighted traffic split

**Option A — Keep single provider per type**: Simple but blocks real-world multi-provider setups. Organizations routinely use 2+ compliance providers for resilience and performance.

**Option B — Priority field on each provider**: Allow multiple active providers; dispatch picks by priority. Simple but only supports primary/fallback, not round-robin or weighted.

**Option C — Dedicated routing group (chosen)**: A new `integrationRoutingGroups` collection defines the strategy. Individual providers reference a group. Dispatch resolves the group first, then applies strategy.

### Decision

Create an `integrationRoutingGroups` collection. Each record defines a `RoutingStrategy` (`primary_fallback | round_robin | weighted | parallel`) and references member providers. Providers can exist without a group (single provider behavior, unchanged). Remove the unique constraint on `(type, endpoint)` — uniqueness is no longer enforced because organizations may use the same endpoint with different credentials.

Supported strategies and their aggregation semantics are defined in `integration-hub-enhancement.md §3.3`.

### PCI DSS Alignment

Each member of a routing group is a separate `ExternalProviderArrangement` record. PCI DSS Req 12.8.1 (maintain list of all TPSPs) is satisfied because every provider is individually documented, health-checked, and key-rotated. The routing group is an operational artifact; it does not replace individual compliance tracking.

### Consequences

+ Organizations can run primary/fallback setups for critical KYC and AML paths.
+ Parallel enrichment enables consensus fraud scoring without additional code.
+ Weighted routing supports zero-downtime provider migrations.
- New collection `integrationRoutingGroups` adds a schema to manage.
- Dispatch hot path now includes a group resolution step (adds ~1ms for group lookup, cacheable in application memory with 30s TTL).
- Parallel strategy multiplies outbound request volume — timeout budgets must account for the slowest member.

---

## ADR-014 — Configurable Field Mapping (No-Code Adapter Pattern)

**Date:** 2026-06-10  
**Status:** Proposed  
**Iteration:** v6+  
**Deciders:** Antonio Membrides Espinosa  
**Full design:** [docs/integration-hub-enhancement.md §3.2](integration-hub-enhancement.md)

### Context

External compliance systems (fraud detection, AML, KYC providers) use different field names and value conventions than the internal data model. Today, field name mismatches require a code-level adapter deployed with the application. This means:
- Adding a new provider requires a code change and deployment
- A legacy system that cannot change its API contract blocks integration
- Inbound webhook field name differences require hardcoded per-provider parsing logic

Three approaches were considered:

**Option A — Hardcode adapters per provider**: Reliable but inflexible. Every new provider or field name change requires code deployment.

**Option B — Custom scripting (JavaScript eval in admin panel)**: Maximum flexibility but creates a code injection surface and is excluded by PCI DSS (Req 6.2.4: prevent code injection).

**Option C — Declarative transformation rules stored in MongoDB (chosen)**: A finite set of safe transform operations (rename, value_map, scale, date_format, nested path, constant_inject, drop) stored as configuration. The dispatch and callback services apply them at runtime. No scripting, no eval.

### Decision

Add a `fieldMappingConfig` sub-document to `ExternalProviderArrangement`. The `FieldMappingEngine` service applies outbound rules before HTTP dispatch and inbound rules before the domain handler receives the payload. The admin UI exposes a table-based rule editor with a "Test with Sample Payload" feature.

**Security constraint**: The engine maintains a PCI DSS blocklist of fields that cannot be read, written, or transformed: PAN, CVV, cardholderName, expiryDate, and all credential hash fields. Mapping rules targeting these fields are rejected at save time.

### BIAN Alignment

`fieldMappingConfig` maps to BIAN SD-193 `ExternalProviderArrangementSpecification` — the technical specification of how the arrangement operates. Field mapping is an arrangement specification detail, not a compliance record.

### Consequences

+ New external providers can be onboarded without code changes by configuring field mappings in the admin UI.
+ Legacy systems with fixed API contracts can be integrated by mapping their field names to internal expectations.
+ The "Test with Sample Payload" endpoint validates mapping rules before they affect live traffic.
- The mapping engine adds a transformation step to the hot path (~0.5–2ms for typical payload sizes).
- Mapping rules stored in MongoDB must be kept current if either the internal model or the external API changes.
- The blocklist approach protects PCI DSS fields but must be actively maintained when new sensitive fields are added.

---

## ADR-015 — Structured Authentication Configuration per Integration

**Date:** 2026-06-10  
**Status:** Proposed  
**Iteration:** v6+  
**Deciders:** Antonio Membrides Espinosa  
**Full design:** [docs/integration-hub-enhancement.md §3.5](integration-hub-enhancement.md)

### Context

ADR-012 stores API keys as bcrypt hashes and HMAC callback secrets as bcrypt hashes. This satisfies PCI DSS for the outbound API key (shown once, never stored in plaintext). However, several auth patterns that real external providers require are not configurable at runtime:

- **API key location**: Some providers want the key in `X-API-Key` header, others in `Authorization`, others as a query parameter. Currently hardcoded to `Authorization`.
- **OAuth2 Client Credentials**: Many enterprise compliance providers (Refinitiv, Kroll, ComplyAdvantage) use OAuth2. There is no place to store `clientId`, `tokenEndpoint`, or `scopes`.
- **Outbound HMAC signatures**: Some providers require us to sign our outbound requests (not just validate their inbound ones). The current model only supports inbound HMAC validation.
- **Bearer token prefix**: Most providers use `Bearer <token>` but some use `Token <token>` or no prefix. Currently hardcoded to `Bearer`.

**Option A — Extend env vars per provider**: Simple but can't be managed by `system_admin` from the UI and can't change at runtime.

**Option B — Additional flat fields on ExternalProviderArrangement**: Low structure. 15+ new fields with overlapping semantics depending on auth type.

**Option C — Typed `authConfig` sub-document + QE-encrypted credential fields (chosen)**: A discriminated union of auth configurations per scheme type. Credential values (tokens, secrets, client secrets) are stored as MongoDB QE-encrypted fields with a dedicated `integrationCredentialsDEK`.

### Decision

Add `authConfig: IntegrationAuthConfig` to `ExternalProviderArrangement`. Add five QE-encrypted fields for credential storage: `authTokenEncrypted`, `authApiKeyEncrypted`, `authHmacSecretEncrypted`, `callbackHmacSecretEncrypted`, `authOauth2SecretEncrypted`. Create a new `integrationCredentialsDEK` under the existing AWS KMS CMK.

The existing `externalProviderApiKeyHash` and `externalProviderCallbackSecretHash` bcrypt fields are retained for backward compatibility but deprecated for new registrations.

### PCI DSS Alignment

| Requirement | How `authConfig` + QE satisfies it |
|---|---|
| Req 3.6 — Protect cryptographic keys | `integrationCredentialsDEK` is a dedicated DEK under the KMS CMK; credential key rotation does not require re-encrypting cardholder data |
| Req 3.5 — Protect keys used to protect stored data | QE ensures credential values are never stored in plaintext in MongoDB |
| Req 12.3.4 — Review all hardware/software annually | `bearer.tokenExpiresAt` field enables expiry tracking and UI warnings |
| Req 6.3.3 — Protect against known vulnerabilities | QE encryption prevents credential exposure from a compromised database |

### Consequences

+ OAuth2, outbound HMAC, and flexible API key location are configurable from the admin UI without code changes.
+ `integrationCredentialsDEK` limits the blast radius of a credential compromise to integration credentials only.
+ The dispatch service can now build correct auth headers for any supported scheme from configuration alone.
- New QE encrypted fields on `integrationRegistry` require QE to be enabled for this collection (previously plaintext only — see ADR-012).
- `integrationCredentialsDEK` adds a sixth DEK to manage (existing: lookupDEK, sensitiveDEK, plus future additions).
- The `system_admin` UI must handle QE-encrypted fields differently from plaintext fields (write-only; no read-back of credential values).

---

## ADR-016 — Category-Specific Extended Configuration

**Date:** 2026-06-10  
**Status:** Proposed  
**Iteration:** v6+  
**Deciders:** Antonio Membrides Espinosa  
**Full design:** [docs/integration-hub-enhancement.md §3.4](integration-hub-enhancement.md)

### Context

The six compliance integration categories (fraud_detection, aml_monitoring, kyc_identity, kyb_business, hrp_sanctions, credit_bureau) have fundamentally different operational parameters:
- A fraud detection provider needs score thresholds and response field names.
- A KYC provider needs verification levels, document types, and re-verification periods.
- A sanctions screening provider needs watchlist sources and fuzzy match thresholds.
- A credit bureau needs pull type (soft/hard), scoring model, and jurisdiction.

Today none of these parameters are configurable — they are either hardcoded or absent. This limits the demo's ability to show realistic integration management and prevents the admin from configuring provider behavior without code changes.

**Option A — Flat fields on ExternalProviderArrangement**: Adds 30+ optional fields to the model, most of which are irrelevant for any given category. Validation is complex.

**Option B — Per-category collections**: Six new collections. Clean schema per type but massive overhead for a registry that will have at most ~20 records.

**Option C — Typed `categoryConfig` discriminated union (chosen)**: A polymorphic sub-document with one interface per category. MongoDB's document model handles this naturally. The backend validates the config shape against the declared type. The admin UI renders a different form per type.

### Decision

Add `categoryConfig` as a polymorphic sub-document to `ExternalProviderArrangement`. Define six typed config interfaces (FraudDetectionConfig, AmlMonitoringConfig, KycIdentityConfig, KybBusinessConfig, HrpSanctionsConfig, CreditBureauConfig) plus a GenericIntegrationConfig. Backend validation uses a Zod discriminated union keyed on `externalProviderArrangementType`.

### BIAN Alignment

`categoryConfig` maps to `ExternalProviderArrangement.ExternalProviderArrangementRecord` in BIAN SD-193 — the record of agreed terms and specifications for the arrangement. Each category config captures the domain-specific terms of the third-party arrangement.

| Category | BIAN SD | Key config fields and their BIAN equivalent |
|---|---|---|
| fraud_detection | SD-63 Fraud Evaluation | scoreThresholds → FraudEvaluationAssessmentPreconditions |
| aml_monitoring | SD-99 Suspicious Activity Analysis | watchlistSources → SuspiciousActivityAnalysisDataSources |
| kyc_identity | SD-53 Customer Agreement | verificationLevels → CustomerAgreementKycCheckSpecification |
| kyb_business | SD-89 Merchant Relations | uboDisclosureThreshold → MerchantAgreementKybCheckSpecification |
| hrp_sanctions | SD-13 Party Reference Data | screeningLists → PartyReferenceDataDirectoryQualityThreshold |
| credit_bureau | SD-83 Customer Credit Rating | pullTypes → CustomerCreditRatingExternalReference |

### Consequences

+ Admin can configure provider-specific thresholds (score cutoffs, match sensitivity, re-verification periods) from the UI.
+ BIAN compliance is strengthened — arrangement records now capture domain-specific terms as the standard prescribes.
+ Demo presentations can show realistic operational configuration that maps to real-world compliance workflows.
- Backend must validate `categoryConfig` shape against `externalProviderArrangementType` — a Zod discriminated union adds ~50 lines of schema definition per category.
- Changing a category config type after registration requires clearing and re-setting the sub-document.

---

## ADR-017 — Generic Integration Category

**Date:** 2026-06-10  
**Status:** Proposed  
**Iteration:** v6+  
**Deciders:** Antonio Membrides Espinosa  
**Full design:** [docs/integration-hub-enhancement.md §3.4](integration-hub-enhancement.md)

### Context

The six compliance categories (fraud, AML, KYC, KYB, HRP/sanctions, credit bureau) cover the primary regulated compliance functions. However, enterprise financial systems need integrations for operational events that don't fit a compliance domain: contract signing callbacks, document archival, notification dispatch, audit export, regulatory reporting pipelines.

Today these would either be hardcoded outside the integration registry (losing the audit trail, health monitoring, and API key management that the registry provides) or forced into an inappropriate compliance category (misrepresenting the BIAN alignment).

**Option A — Refuse to register non-compliance integrations**: Simplest but forces operational integrations out of the registry and its PCI DSS audit trail.

**Option B — Extend each existing category**: Add catch-all fields to existing types. Breaks the clean category-specific config model.

**Option C — Add a `generic` category type (chosen)**: A seventh category with `GenericIntegrationConfig` that allows user-defined labels, event types, and an optional JSON Schema for payload validation. No BIAN compliance domain is claimed; BIAN reference is set to SD-193 itself.

### Decision

Add `'generic'` to `IntegrationProviderType`. The `bianServiceDomain` for generic integrations is set to `"External Provider Arrangements"` (SD-193) and `bianControlRecordType` to `"ExternalProviderArrangementPortfolio"`. All registry infrastructure (health monitoring, event audit log, API key management, field mapping) applies to generic integrations identically.

**PCI DSS note**: Generic integrations are still listed in the registry (Req 12.8.1 — list of all TPSPs). The `GenericIntegrationConfig.description` field should be used to document the business purpose of the integration for Req 12.8.2 (written agreement acknowledging responsibility).

### Consequences

+ Non-compliance integrations benefit from the same health monitoring, audit trail, and key management as compliance integrations.
+ The registry becomes a single source of truth for all external system dependencies, not just compliance providers.
+ Generic integrations are visible in PCI DSS TPSP lists (Req 12.8.1), improving audit completeness.
- The `system_admin` UI must clearly distinguish generic integrations from compliance integrations to avoid confusion during audits.
- `generic` integrations have no BIAN SD alignment beyond SD-193 itself — this must be documented clearly in audit reports.

---

## ADR-018 — Simulator/Application Parity: real auth, account-reference normalization, curated roster

**Status:** Accepted (2026-06-12)

**Context**

ADR-004 established the dual-mode frontend. In practice the Simulator had drifted from being a faithful demonstration of the real system:

1. The investigation flow (`simulator/investigation/[caseId]`) was a static, hard-coded narrative. Escalation, L2 approval, and resolution were **not** persisted — they never called the real API. It also rendered **fictional data** (a Springfield address, a fake government ID, fabricated ciphertext), violating the principle that the Simulator runs on real system data.
2. The Simulator performed no authentication; it relied on public-GET routes and could not exercise role-gated mutations, so a case "escalated" in the Simulator never appeared for an L2 user in Application mode.
3. The demo user roster was duplicated and inconsistent across four sources (`users.json` [dead], `customerAuthentications.json`, a hard-coded frontend map, and the docs), with mixed email domains.
4. `cardTransactionAccountReference` (QE:equality) held **heterogeneous** values — seeded transactions used the business key `ACC-xxx`, while the Simulator wrote the payer email — so no single query surfaced a customer's full history, and Application-mode history relied on a `localStorage` mirror (a second source of truth).

**Decision**

- **Real authentication, no bypass.** The Simulator obtains a real per-role JWT via the existing `POST /api/v1/auth/login` using the shared demo credential (centralized as `DEMO_PASSWORD`). A frontend helper (`lib/simulatorAuth.ts`) caches tokens per role. Escalate → approve → resolve now hit the real `/api/v1/fraud/*` endpoints and persist, achieving bidirectional parity. No demo-only auth endpoint was added.
- **No fictional data.** The investigation flow reads the real case, customer record, and live Atlas ciphertext (raw document) with the real L2 escalation token. All fabricated constants were removed.
- **Curated roster flag.** `customerAuthenticationDemoFeatured: boolean` marks the curated set (4 customers incl. the simulator merchant owner, 2 L1, 2 L2, 2 auditors, 2 merchant officers, 1 manager). `GET /api/v1/system/users?featured=true` (and `/system/users`) returns it; the debug-mode picker and Simulator consume it. The full seed stays intact for ad-hoc testing. Emails unified to `@back.es`. `users.json` deleted (dead).
- **Account-reference normalization.** `createTransaction` resolves the payer (email **or** `ACC-xxx`) to the customer's canonical `customerAgreementReference` and stores **that** in `cardTransactionAccountReference`. History lookups (`getAllTransactions` `email` filter and the Simulator transactions endpoint) resolve email → `ACC-xxx` and match the QE:equality field, covering both seeded and Simulator-created transactions. The `localStorage` mirror (`simulatorHistory.ts`) was removed; Application mode reads history from `GET /api/v1/transactions/all`, scoped server-side to the customer's own email for the `customer` role (privacy).

**Consequences**

- (+) A Simulator action is now indistinguishable from an Application-mode action in the database; the demo proves the real security model (RBAC + QE) rather than narrating it.
- (+) Single source of truth for the roster and for transaction history.
- (+) Removed dead/duplicated resources: `users.json`, the hard-coded password map, fictional investigation constants, `simulatorHistory.ts`, and the legacy `*Sensitive.json` export files.
- (−) The Simulator now depends on the auth and fraud endpoints behaving correctly; an RBAC bug surfaces in the Simulator (intended — it is now an honest test surface).
- (−) Customer-facing case status in Application-mode transaction **history list** is not shown (customers are blocked from `/fraud`); customer-visible case notes remain available on the detail page via the dedicated customer-safe notes endpoint. A customer-safe case-status projection on `/transactions/all` is a possible follow-up.

---

## ADR-030 — Data-Driven RBAC/ACL + Role & User Administration by Domain

**Status:** Accepted (2026-06-15). Implemented v8.1 (Phases A–C). Aligns **PCI DSS Req 7** (RBAC, least privilege, default-deny, documented matrix, separation of duties) and **BIAN SD-16** (Party Authentication).

**Context.** Authorization was hard-coded across ~13 files (`auth.ts` prefix/role sets, per-controller role checks). This made the policy impossible to review as a whole (Req 7 wants a documented matrix) and impossible to change without code edits. The trigger: the `manager` (SD-193 integration admin) could reach business/cardholder data (`/system/transactions/:id`), violating separation of duties.

**Decision.**
1. **Static catalog, data assignment (E1).** The permission catalog (resource × action) lives in code (`acl.model.ts` back / `config/acl.ts` front) — it mirrors the real enforcement points, so no permission exists without a guard. Role→permission assignment is data in a new **`role`** collection (CRUD by the manager). The matrix in code doubles as the seed and the runtime fallback, so the DB can never diverge from what enforcement expects.
2. **Global roles & actions (E2).** Roles/actions are global across authentication domains. Per domain only the *binding* differs: **local** = user CRUD + role assignment; **remote (OIDC/SAML)** = claim/group → role mapping (`partyAuthenticationDomainRoleMappings`).
3. **Builtin vs custom (E3).** Six builtin roles (matrix in `technical-spec §1.15`) — permissions editable, not deletable. Custom roles: full CRUD, any subset incl. full-manage.
4. **Enforcement.** `requirePermission(resource, action)` — a Fastify preHandler, default-deny, with a cached role load (TTL + invalidation on edit) and builtin fallback so it never fails open. `viewSensitive` additionally requires the existing escalation flow (`canReadSensitive`). `GET /api/v1/acl/effective` exposes the caller's resolved permissions so the frontend `can()`/`<RequirePermission>` work without putting permissions in the JWT (changes apply without re-login). `extractDemoRole` trusts the signed token's role (so custom roles resolve through the ACL) while the untrusted `x-demo-role` header stays restricted to builtins.
5. **UI.** `/system/admin/roles` (matrix editor, builtin-protected) + per-domain access panels under Auth Domains (users for local, role mapping for remote) + a reusable `<AccessDenied>` whose body lists the role's responsibilities **derived from the live ACL** (not hard-coded).

**Consequences.**
- (+) Req 7 evidence is a single documented, queryable matrix; the manager is provably excluded from CHD (`can('manager','transactions',*) === false` → 403 + AccessDenied).
- (+) New roles/permissions need no code change; enforcement is one reusable guard.
- (+) Default-deny is surfaced to the user (AccessDenied) instead of a blank/erroring page.
- (−) A new collection (`role`) + seed + cache to maintain. Mitigated by code-as-source-of-truth seed/fallback.
- (−) `requirePermission` adds one cached DB read per guarded route (30s TTL); negligible.

---

## ADR-031 — Customer Questions and Responses on Fraud Cases

**Status:** Accepted (2026-06-15). Implemented v8.2. Aligns **BIAN SD-83** (Fraud Diagnosis) and **PCI DSS Req 10** (immutable, traceable audit of investigation interactions).

**Context.** During an investigation, L1/L2 agents need a structured way to ask the customer a question (e.g. "Did you perform this operation?") and capture the answer as part of the case record, rather than free-form notes. The customer must be able to respond from their own transaction view, be notified of pending questions, and the answer must be tamper-evident.

**Decision.**
1. **New collection `fraudDiagnosisCustomerQuestion`** (plaintext, no CHD) linked to the case (`fraudDiagnosisInstanceReference`), the transaction (customer entry point) and the owning party (ownership checks). A question carries `questionText`, predefined `questionOptions[]`, an `allowOther` flag, `questionStatus` (`pending`/`closed`), and an immutable response (`responseOption`, optional `responseText`).
2. **Investigator API** (L1/L2, fraud-case scope): `POST /api/v1/fraud/:id/questions`, `GET /api/v1/fraud/:id/questions`. The options list is fully customizable per question.
3. **Customer API** (on the transaction, `transactions:view`): `GET /api/v1/transactions/:id/questions` (scoped to the caller's own party) and `POST /api/v1/transactions/:id/questions/:questionId/response`. The answer is written with an **atomic pending→closed transition** — it cannot be edited or resubmitted (immutability, Req 10). Ownership is enforced by the caller's party (Req 7).
4. **Notifications**: `GET /api/v1/notifications` returns the caller's pending questions; a "Notifications" entry + count badge appears in the customer menu and links to the relevant transaction.
5. **Event tracking**: create and answer each emit a `businessProcessEvent` (`fraud.question.created` / `fraud.question.answered`) for the unified audit feed, and append a `fraudDiagnosisCaseEvents` entry (`question_created` / `question_answered`) so the case timeline shows the full interaction.

**Live updates & notifications (v8.3).**
6. **SSE**: `GET /api/v1/fraud/:id/stream` streams case events (`question.created`/`question.answered`) to the investigation view so L1/L2 see a customer's answer without a manual refresh. An in-process event bus (`caseEventBus`) publishes on create/answer; the client consumes via `fetch` + `ReadableStream` (Bearer header, no token in the URL — Req 4). Investigation roles only; a valid JWT is required (no anonymous stream). No CHD is streamed (Req 3).
7. **Notifications** are **derived** (no stored collection) from authoritative records per party: pending questions (actionable) + resolved cases (informational). Surfaced via a top-bar bell (latest 5 + count badge + "View all") and a full `/system/notifications` page with search/type-filter/pagination. `GET /api/v1/notifications` is scoped to the caller's own party (Req 7).

**Consequences.**
- (+) Structured, auditable customer interaction; every question and response is timestamped and attributed (Req 10).
- (+) Immutable answers (no edit after submit) give a defensible investigation record.
- (+) Live (SSE) L2 updates + a derived notification feed reuse the existing case/events/RBAC architecture; no parallel system, no extra collection for notifications.
- (−) One new collection (`fraudDiagnosisCustomerQuestion`) to maintain. The SSE bus is single-process (demo); a multi-instance deployment would back it with Redis pub/sub or MongoDB change streams.

## ADR-032 — Event-Driven Architecture: EventBus vendor, correlated event store, two-phase async payment authorization

**Status:** Accepted (2026-06-16). Implemented dev.v8 (F1-F5). Aligns **PCI DSS Req 3.2** (no SAD), **Req 10** (traceable audit) and **BIAN SD-254 / SD-88 / SD-63 / SD-13 / SD-99**.

**Context.** Event handling was scattered: a per-case in-process `EventEmitter` (`caseEventBus`) plus direct writes to three event collections (`businessProcessEvent`, `complianceProcessEvent`, `externalProviderArrangementActionLog`). Following the real-PSP model, a card payment must wait for the issuer's decision (and other real-time risk checks) from providers with asynchronous flows, while the client waits for the outcome — and an investigation must be able to follow the whole journey across subsystems, not chase scattered logs.

**Decision.**
1. **EventBus vendor (port/adapter), one instance for ALL events** (`backend/src/vendors/eventbus`). The system depends only on the `EventBus` port (`publish`/`subscribe`); the default `EventBusInProcess` adapter uses Node `EventEmitter` (name-indexed exact dispatch + `eventType\0correlationId` composite keys for journey-scoped subscriptions + a small wildcard list). Migrating to Kafka/RabbitMQ swaps only the adapter in `initEventBus` — no publisher/consumer changes. The former `caseEventBus` signals run on the same bus, marked `transient` (delivered, not persisted).
2. **`DomainEvent` envelope + correlated event store** (`domainEvent` collection). Every event carries `eventId` (idempotency), `eventType` (dotted, module-prefixed), `correlationId` (= the journey, the `cardTransactionInstanceReference` for a payment), `causationId`, `businessProcess`, `partitionKey` (Kafka-ready). CHD is stripped on publish (`sanitizeDeep`, single CHD blocklist owned by the vendor). The legacy `emitProcessEvent`/`emitComplianceEvent`/`logEvent` also mirror to the store with correlation. `GET /api/v1/events/trail/:correlationId` returns the ordered journey.
3. **Two-phase async payment authorization.** `POST /transactions` creates the transaction `pending` and returns `202`; the client subscribes to `GET /api/v1/transactions/:id/stream` (SSE, public by txn UUID, no CHD) for the outcome. **Phase 1 (gate):** `card-issuer` + `fds` + `hrp` (sanctions) run in parallel, out-of-band; each funnels a `*.completed` verdict onto the bus and `PaymentAuthorizationSaga` aggregates them — any hard decline → `payment.declined` (short-circuit), all approve → `payment.authorized`. CHD (PAN/CVV/expiry) goes straight to the issuer via dispatch, never on the bus. **Phase 2 (post-auth, async):** `PostAuthorizationProcess` runs AML monitoring (never blocks the authorized payment) and enriches the fraud case from the correlated trail (`fraudDiagnosisCase.subsystemSignals`).
4. **Backward compatibility.** `createTransaction` is kept as a synchronous wrapper (initiate + await the terminal event) so the gateway (checkout / payment-link) is unchanged.

**Consequences.**
- (+) One coherent event mechanism; a broker migration is an adapter swap.
- (+) Full journey traceability by `correlationId` (Req 10) feeds the investigation directly.
- (+) Realistic PSP flow: client waits via SSE; issuer/sanctions/fraud gate in real time; AML/investigation are post-auth.
- (+) No CHD on the bus or in the event store (Req 3.2).
- (−) Saga/Phase-2 aggregation state is in-memory (matches the in-process bus); a multi-instance deployment persists it alongside the broker migration. Event-store retention is not yet a TTL (regular collection for the unique `eventId` index); to be revisited.

---

## ADR-033 — OIDC Authorization Server Implemented from Scratch (No oidc-provider Library)

**Status:** Accepted (2026-07-01). Implements **v16** (Issue #29). Aligns **BIAN SD-16** (Party Authentication) and **PCI DSS Req 8.6** (system account credential management).

**Context.** External merchants and third-party systems need a standard mechanism to authenticate against the PSP and access merchant-scoped data. The `oidc-provider` npm package is the most complete Node.js OIDC library, but it requires a complex MongoDB adapter and introduces a large external security surface in a PCI DSS demo.

**Decision.** Implement the Authorization Server manually using primitives already in the project: `jsonwebtoken` (RS256 signing), `crypto` (PKCE SHA256, RSA keypair generation), `bcryptjs` (client secrets), `uuid` (code/token IDs). Support three grant types: `authorization_code` + PKCE (S256), `client_credentials`, and `refresh_token`. All flows are defined in RFC 6749, RFC 7636, and OIDC Core 1.0.

**Consequences.**
- (+) Fully auditable line-by-line; no hidden adapter layers — appropriate for a PCI DSS demonstration.
- (+) Zero new npm dependencies; no additional CVE surface.
- (+) All grant types are well-specified; implementation is straightforward.
- (−) More development time than a library; no automatic spec-compliance guarantees (covered by integration tests instead).

---

## ADR-034 — OIDC Routes Under /api/v1/auth/ Prefix; Discovery at /.well-known/openid-configuration

**Status:** Accepted (2026-07-01). Implements **v16**.

**Context.** OIDC Discovery 1.0 §4 mandates that the discovery document is served at `{issuer}/.well-known/openid-configuration`. All other endpoint paths are advertised inside that document and have no mandated paths in the spec.

**Decision.** Serve `/.well-known/openid-configuration` at root (no `/api/v1` prefix — spec-mandated). All other OIDC/OAuth2 endpoints use the `/api/v1/auth/` prefix for consistency with the existing internal auth controller (`/api/v1/auth/login`). Fastify's plugin system registers the discovery controller at root level separately from the `/api/v1` prefix.

OIDC endpoints:
- `GET /.well-known/openid-configuration` — discovery document (root, spec-mandated)
- `GET /api/v1/auth/jwks` — JSON Web Key Set (public keys)
- `GET /api/v1/auth/authorize` — Authorization Code flow initiation
- `POST /api/v1/auth/token` — token issuance (all grant types)
- `GET /api/v1/auth/userinfo` — OIDC userinfo claims
- `POST /api/v1/auth/revoke` — RFC 7009 token revocation
- `POST /api/v1/auth/introspect` — RFC 7662 token introspection

**Consequences.**
- (+) Discovery document at spec-mandated path; all other paths consistent with existing codebase convention.
- (+) Any OIDC-compliant client can discover all endpoints from the well-known URL.
- (−) Two registration points in `server.ts` (root + `/api/v1`); mitigated by clear comments.

---

## ADR-035 — RS256 JWT for OAuth Access Tokens; HS256 Retained for Internal PSP Sessions

**Status:** Accepted (2026-07-01). Implements **v16**.

**Context.** The existing internal authentication uses HS256 JWTs (`PSP_JWT_SECRET`). OAuth access tokens must be verifiable by merchants without sharing the PSP's secret — RS256 with a published JWKS endpoint enables this.

**Decision.** Maintain two parallel signing mechanisms:
1. **Internal PSP sessions** — HS256, `PSP_JWT_SECRET`. Used by `loginUser()` for employee/customer sessions. Unchanged.
2. **OAuth access tokens + ID tokens** — RS256, RSA-2048 private key. Issued only by the OAuth token endpoint. Verifiable by anyone holding the public key from `/api/v1/auth/jwks`.

The `sub` claim in OAuth tokens is the `customerAuthenticationInstanceReference` (for user-bearing flows) or `clientId` (for `client_credentials` flow). The `iss` claim is the PSP base URL (`PSP_BASE_URL` env var).

**Consequences.**
- (+) Merchant-verifiable tokens without sharing any PSP secret — standard OAuth architecture.
- (+) Existing internal authentication is completely unaffected.
- (−) Two key types to manage; mitigated by the `OAuthKeyProvider` abstraction (ADR-036).

---

## ADR-036 — RSA Private Key Is Never Persisted in MongoDB; Switchable OAuthKeyProvider (local|aws) Mirrors QE KMS_PROVIDER Pattern

**Status:** Accepted (2026-07-01). Implements **v16**. Aligns **PCI DSS Req 3.6** (cryptographic key management).

**Context.** JWT signing requires an RSA private key at runtime. Storing it in MongoDB would mean any client with a valid connection string could extract and forge any JWT — a complete authentication bypass, violating PCI DSS Req 3.6. The project already uses a `KMS_PROVIDER=local|aws` pattern for QE field encryption.

**Decision.** Mirror the existing pattern with `OAUTH_KEY_PROVIDER=local|aws`:

```
OAUTH_KEY_PROVIDER=local  →  LocalKeyProvider
  Private key: $OAUTH_KEY_STORE_DIR/private.pem  (chmod 600, never committed)
  Dev:         auto-generated on first startup (NODE_ENV=development only)
  Docker:      bind-mount or named volume
  K8s:         Secret mounted as volume

OAUTH_KEY_PROVIDER=aws  →  AwsKmsKeyProvider
  Private key: never exported from AWS KMS hardware
  Signing:     kms.sign() call — key never in application memory
  Same AWS credentials as QE (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
```

Both providers expose a common `OAuthKeyProvider` interface. `npm run setup:key:rsa` generates the keypair (`private.pem` + `public.pem`) before first run (analogous to `npm run setup:db` for QE).

**Consequences.**
- (+) Private key never in the database; FIPS 140-2 hardware boundary available via `aws` provider.
- (+) Same operational pattern as QE — existing runbooks and K8s Secret patterns apply.
- (+) JWKS multi-key rotation with grace period, driven by the provider (see amendment).
- (−) One new setup step (`npm run setup:key:rsa`); documented in README and installation guide.

**Amendment (2026-07-03) — FS-first: provider is the single source of truth.**
The original design used the Atlas `partyAuthenticationKey` collection as the source for the JWKS and stored the public key there on rotation. This created a dual source of truth that broke dashboard-initiated rotation: `generateAndActivateKey`/`uploadKey` wrote the new **public** key to the DB and marked it active, but **never persisted the new private key**, so the signing provider kept using the old key file — the advertised active `kid` could never sign. Corrected design:
- The `OAuthKeyProvider` (filesystem / KMS) owns all key material and is the only source for signing, verification, and the JWKS. Interface: `sign`, `getKid`, `getPublicKeyJwk`, `listPublicKeys`, `getPublicPemByKid`, `supportsRotation`, `rotate`, `importKeypair`, `revoke`.
- `LocalKeyProvider` layout: active private at `private.pem`, active public at `public.pem`, and deprecated **public-only** keys under `retired/<kid>.pub.pem` for the grace period (deprecated private material is dropped — only the active key ever signs).
- Token verification resolves the public key by the token's `kid` (active **or** a deprecated key still in grace), enabling a real rotation grace period.
- `partyAuthenticationKey` is now an **audit mirror** only (status + provenance for the admin dashboard), reconciled from the provider on startup and after every mutation. It is never read to verify tokens or build the JWKS.
- KMS rotation/import/revoke are unsupported in-process (managed inside AWS KMS); `supportsRotation()` returns false.

---

## ADR-037 — Merchant Portal API as OAuth-Authenticated Namespace (/api/v1/merchant/portal/)

**Status:** Superseded by **ADR-042 (v23)** (2026-07-09). Originally Accepted (2026-07-01), implemented **v16**. Aligns **BIAN SD-89** (Merchant Relations), **PCI DSS Req 7** (least privilege), **Req 8.6** (system account lifecycle).

> **Superseded.** The dedicated `/api/v1/merchant/*` namespace was removed in v23. The merchant is now
> just another API client on the SHARED capability modules (`/beneficiaries`, `/accounts`, `/transactions`,
> `/gateway/transfers`, `/notifications`): a cross-cutting dual-auth resolver (`vendors/middleware/dualAuth.ts`
> + the `config: { dualAuth: true }` route flag) accepts EITHER a PSP session JWT (RBAC) OR a merchant OAuth
> Bearer (scope + subject binding). The OAuth token type, `validateMerchantToken`, scope catalog and subject
> binding all remain; only the parallel `/merchant/*` route surface was retired (no separate merchant portal).

**Context.** Merchants today access their data through the PSP application UI. To support programmatic integration, merchants need a machine-readable API. Reusing the internal PSP JWT (`role: merchant`) would conflate PSP-internal roles with external system accounts, violating PCI DSS Req 8.6's requirement for separate system account management.

**Decision.** Create a dedicated `/api/v1/merchant/portal/` namespace authenticated by OAuth merchant access tokens (not internal JWTs). A `validateMerchantToken` middleware: (1) verifies RS256 JWT signature, (2) extracts `client_id`, (3) resolves the merchant from `merchantAgreementProcedure`, (4) checks `oauthClientStatus === 'active'`, (5) enforces scope-based access control per endpoint.

All responses are scoped to the authenticated merchant's own records only:
- `GET /api/v1/merchant/portal/me` — own merchant profile (scope: `read:merchant_profile`)
- `GET /api/v1/merchant/portal/transactions` — own transaction metadata, NO customer PII (scope: `read:transactions`)
- `GET /api/v1/merchant/portal/checkout-sessions` — own sessions (scope: `read:orders`)
- `GET /api/v1/merchant/portal/payment-links` — own links (scope: `read:orders`)
- `GET /api/v1/merchant/portal/notifications` + SSE (scope: `read:notifications`)

**Consequences.**
- (+) Merchants access only their own data — Req 7 least privilege enforced at middleware level.
- (+) OAuth client lifecycle (issue / rotate / revoke) satisfies Req 8.6 system account management.
- (+) All merchant portal calls emit `businessProcessEvent` via existing EventBus — Req 10 audit.
- (−) New middleware in the request path; tested independently with expired/revoked/wrong-scope tokens.

## ADR-038 — Funds-Availability Gate + Currency Exchange (Bank-Movement Cycle Precision)

**Status:** Accepted (2026-07-03). Implements **v17**. Aligns **BIAN SD-36** (Account Information / AIS), **SD-15** (Card Authorization), **SD-66** (Payout Account / PISP), **PCI DSS Req 10.2.1** (audit of fund movements).

**Context.** Card-payment authorization verified the issuer, fraud (FDS) and sanctions (HRP) gates but **never checked whether the funding account had sufficient balance**. The balance hold ran *post-authorization*, asynchronously and fire-and-forget, so an authorized payment could exceed available funds (the conditional hold failed silently). Balances could also be mutated in a mismatched currency (EUR card on a USD account). This broke the invariant that no balance goes negative in origin or destination.

**Decision.**
1. **Funds gate as a 4th parallel gate** of `PaymentAuthorizationSaga` (`card.issuer` + `fds` + `hrp` + **`funds`**). Events `funds.check.requested` / `funds.check.completed` (BIAN SD-36). The reactor (`providerGroups.onFunds`) resolves `cardToken → fundingPayoutAccount`, reads balance via the **`account_information` capability** (provider-indifferent: built-in module reads the internal ledger; an external PSD2 AIS substitutes it via `dispatchProvider` — **no internal/external branching**), and performs the **atomic hold** (`holdCardFunds`, `$gte`-conditional `$inc`). The hold is the authoritative decision: no read-modify-write race.
2. **Scope of the gate.** It governs ONLY cards funded by a PSP-internal payout account (`fundingPayoutAccountInstanceReference`). New/unsaved tokens and external cards pass through (their funds are the issuer's responsibility — the `card.issuer` gate).
3. **Compensation.** On any-gate decline, the saga releases the hold (`releaseCardHold`, pending → available), idempotently, including the ordering race where the hold lands after an earlier decline. Settlement clears the hold via `settleCardDebit`. Insufficient funds → `declined` + ISO-8583 `'51'` + `decisionReason 'insufficient_funds'` (no new BIAN status; the reason code carries it).
4. **Currency Exchange built-in module** (new capability `currency_exchange`): `convert(amount, from, to)` = mid cross-rate (via base currency) + configurable spread. Money-movement points (card hold/settle, merchant debit/credit, P2P credit, refund) convert into the account currency so **no balance is ever mutated in a mismatched currency**. Replaceable by an external FX provider.
5. **Seed reconciliation.** All seeders default to **EUR**; `pending/reserved` start at 0 and `balanceCreditLog` `initial_deposit == total balance`, so seeds start fully reconciled (Σ credits − Σ debits == balance).

**Consequences.**
- (+) A payment can no longer be authorized without sufficient funds; origin and destination balances stay consistent and non-negative. Req 10.2.1 audit preserved (every hold/release/settle is atomic `$inc`).
- (+) Provider-indifferent: swapping the built-in AIS/FX for an external provider requires no flow change.
- (+) The post-auth double-hold is removed (`decrementCardFundingBalance` now only credits refunds).
- (−) One extra parallel gate + HTTP loopback read per PSP-funded card payment (consistent with the existing gate cost). Full transaction-replay for seed balances was deliberately NOT done (opening deposit == reconciled current balance) to preserve story-persona balances; a `reconcilePayoutBalances` replay seeder is deferred.

## ADR-039: Bank transfers via provider dispatch + shared rail engine (v17.1)

**Status:** Accepted (2026-07-04)

**Context:** v17.1 adds ACH/SEPA/SWIFT bank transfers. The PSP does not own balances or virtual
accounts; it operates over accounts held by external banks. Every money movement and balance read must
therefore go through providers (external or built-in), preserving the EDA + Hexagonal architecture.

**Decision:**
1. Bank transfers are executed by dispatching to the `payment_initiation` provider (never a direct
   built-in import), so an external PISP can replace the built-in module without changing the flow.
2. Rail derivation, validation and fee pricing live in one shared, pure, OOP module
   (`shared/services/bankTransfer`: `RailResolver`, `FeeCalculator`, IBAN/BIC/ABA validators, standard
   return-code maps) reused by the provider, the orchestrator, the API and the frontend contract (DRY).
3. Rail is auto-derived (EUR+IBAN+EEA -> SEPA; USD+routing+US -> ACH; BIC cross-border -> SWIFT) with a
   user override; validation follows ISO 13616, ISO 9362 and the NACHA ABA checksum.
4. Unregistered destinations are transaction-scoped by default (bound to the execution); persisted as a
   beneficiary only on explicit opt-in.

**Consequences:** No deviation from BIAN SD-65/66 or PCI DSS (Req 3 encryption of bank data, Req 10
audit via `businessProcessEvent`/`complianceProcessEvent` correlated by execution reference). The
built-in module may read the PSP DB, but callers stay provider-agnostic.

*Added 2026-07-04 (v17.1; doc + code together per repo rules).*

## ADR-040: Recipient identity on the payment execution + regulatory framing (v17.2)

**Status:** Accepted (2026-07-04)

**Context:** The payment-history detail (`/system/payment/history/{ref}`) showed an empty Recipient for
bank transfers because the execution (SD-65) persisted no destination identity. Earlier code (and a
comment on `payoutAccountIban`) mislabelled IBAN handling as "PCI DSS Req 3.3".

**Decision:**
1. **Regulatory framing corrected:** PCI DSS governs **card data (PAN/CHD)** only. IBAN / routing / BIC
   are **bank account data → GDPR Art. 32 + PSD2**. Both are QE-encrypted at rest, for distinct drivers.
2. **Recipient identity persisted on SD-65**, linking every known resource: `beneficiaryArrangementReference`
   (→ `/system/beneficiaries/{cab…}`), `resolvedPayoutAccountReference` (→ `/system/accounts/{pau…}`), and
   for unregistered externals `destinationIban` (full IBAN, **QE:none `DEK-exec-dest-iban`, L2 only**) +
   `beneficiaryName` + `destinationAccountMasked` (plaintext, list views) + `destinationCountry`.
   Registered destinations are not matched by IBAN (QE:none is non-searchable — that is the control); the
   linking reference is captured at initiation instead.
3. **KYC demographics belong to Party (SD-13), uniformly for all party types** (customer + employee):
   `partyPostalAddress` added; `partyDateOfBirth`/`partyNationality` backfilled by the seeder. The KYC
   *verification* workflow + govId stay in SD-53 (customers); KYB stays merchant-level. No SD-53 record is
   forced onto employees (that would deviate from BIAN). `GET /auth/me` returns the Party record for all roles.
4. **Setup + seeder are the source of truth** for the data-model change (new collection encryption, DEK,
   seed demographics), per `CLAUDE.md §Data-model changes`. `paymentExecutionProcedure` becomes a
   QE-encrypted collection created via `createCollections`; DB is rebuilt with `--reset` + reseed.

**Consequences:** No BIAN/PCI/GDPR deviation; staff profiles are as complete as customers'; the Recipient
block always shows a navigable link or the full destination. Existing executions predating the change show
"Recipient not resolved" until reseeded.

*Added 2026-07-04 (v17.2; doc + code together per repo rules).*

## ADR-041: Merchant SSO Integration App + activity attribution + commission model (v18)

**Status:** Accepted (2026-07-06)

**Context:** v18 adds an external merchant experience: a standalone app where a merchant signs in with
its PSP identity (SSO), views the PSP activity attributed to it, and configures its commission. This must
not fork the PSP data model or bypass its regulated boundary. Three questions had to be resolved: how the
merchant app relates to the PSP, how merchant commission is modelled BIAN-purely, and how per-merchant
activity is attributed without a new collection.

**Decision:**
1. **Standalone external app.** `merchant/` is a separate Next.js app that owns **no database and no
   Fastify layer**. Its route handlers act as a confidential OAuth client; it integrates with the PSP
   exclusively via the PSP API + OAuth2/OIDC SSO (per ADR-033–037). Local port `8082` / container `8080`;
   env prefix `PSP_MERCHANT_`. This keeps the PSP the single system of record and puts the merchant app
   fully outside the CHD boundary (PCI SAQ A).
2. **Commission model — no new collection.** The numeric commission reuses the existing
   `paymentExecutionProcedure.feeAmount` (SD-65); a new attribution sub-doc `fee { feeMerchantReference,
   feeRateApplied, feeCollectedDateTime }` records who was charged, at what rate, and when. The rate lives
   on SD-89 as `merchantCommissionRate` (editable in merchant settings, audited). Aggregate
   `commissionRevenue` is **derived**, not stored. *(Runtime fee-wiring, A-06, was deferred here and is
   closed in ADR-056: the fee is withheld from the gross and credited to a PSP revenue ledger.)*
3. **Activity attribution — no new collection.** The existing `businessProcessEvent` gains `clientId`,
   `merchantAgreementReference`, `actingPartyReference`, and `actingChannel`, so PSP events can be filtered
   per merchant / per connected app without a parallel event store.
4. **OAuth: granular + incremental consent.** The user selects scopes; unknown scopes return
   `invalid_scope` per RFC 6749; broadening scope forces re-consent. Merchant-facing PSP endpoints use
   `skipAuth` + `validateMerchantToken` + sub-binding; scopes follow the PSP `verb:resource` convention.
5. **Merchant branding** is driven by OIDC client metadata `logo_uri` / `client_uri`.

**Consequences:** BIAN-pure (SD-65 fee, SD-89 agreement, SD-13 acting party) with no new collections. PCI
SAQ A holds — no CHD ever reaches the merchant app; IBAN is masked-only in merchant views (GDPR Art. 32 /
PSD2). Least-privilege scopes + separation of duties are enforced at the token boundary. Trade-off: the
API-driven payment OAuth path remains a follow-up.

*Added 2026-07-06 (v18; doc + code together per repo rules).*

## ADR-042: Unify the merchant integration onto the existing API (dual-auth, no /merchant/* surface) (v23)

**Status:** Accepted (2026-07-09). Supersedes the route-surface portion of **ADR-037**.

**Context:** v16–v18 grew a parallel `/api/v1/merchant/*` route tree (portal, gateway, beneficiaries) that
duplicated capabilities already owned by the PSP modules (`/beneficiaries`, `/accounts`, `/transactions`,
`/gateway/transfers`, `/notifications`). The only genuine difference between a first-party call and a
merchant call is the authentication channel; everything else (services, BIAN control records, display-safe
projections) was identical. A forked surface violates the repo's no-duplication rule and drifts over time.

**Decision:**
1. **Auth is a cross-cutting concern, not a forked API.** A shared resolver `vendors/middleware/dualAuth.ts`
   plus a `config: { dualAuth: true }` flag on the global `authMiddleware` lets one capability route accept
   EITHER a PSP session JWT (HS256 → RBAC via `dualPermission`) OR a merchant OAuth Bearer (RS256 → scope +
   subject binding, via the existing `tryMerchantContext`/`validateMerchantToken`).
2. **Owner is derived, never in the URL for the OAuth channel.** `resolveOwner()` maps `token.sub` → SD-13
   party; a path owner (if present) must equal `token.sub`. Owner-derived routes register both a paramless
   and a `:ownerRef`/`:partyRef` form sharing one handler (path param optional/derived).
3. **Delete the `/merchant/*` tree** (`merchantPortal`, `merchantGateway`, `merchantBeneficiary` controllers)
   and repoint the merchant `PspClient` + browser proxy allowlist to the shared endpoints. Single-release
   cutover (both apps deploy together); no `/merchant/*` aliases.
4. **Notifications exposed to the merchant** (`read:notifications`) on the shared `/notifications` surface.
5. **`/api/v1/transactions` special case.** It is a `PUBLIC_EXACT` path (simulator), so the OAuth Bearer is
   detected best-effort (`tryMerchantContext` preHandler) rather than via the `dualAuth` flag, to avoid
   401'ing anonymous simulator reads.

**Consequences:** One capability = one endpoint = one schema, dual-authenticated. Display-safe guarantees
(no CHD/PCI SAQ A, masked IBAN, no `counterpartyPartyReference`), subject binding, and SD-89 merchant
isolation are all preserved. The OAuth token model, scope catalog and `validateMerchantToken` are unchanged;
only the parallel route surface is gone. Trade-off: capability handlers now branch on channel, and the
public-exact transactions route needs its bespoke OAuth detection.

*Added 2026-07-09 (v23; doc + code together per repo rules).*

---

## ADR-043: Collection classification — Core PSP vs Integration/EDA infra vs Module-owned (v30)

**Status:** Accepted (2026-07-22).

**Context:** As built-in modules become extractable to microservices (ADR-029), the codebase needs an
explicit statement of which collections are the PSP's own business domain, which are integration / event
infrastructure, and which belong to a replaceable module. Until v30 every collection was either core or
stateless module config; the card-issuer PAN vault (ADR-044) is the first case of a module owning its own
data, so the boundary must be written down together with the ports that cross it.

**Decision:** Classify every collection into three groups and express all cross-frontier reads as ports.

**Core PSP (business domain, never replaced by a provider):**
`party`, `customerAgreementProcedure`, `customerAuthenticationAssessment`, `partyAuthenticationAssessment`,
`partyAuthenticationKey`, `partyAuthorizationCode`, `partyBackchannelAuthentication`,
`partyEnrolledCredential`, `partyIssuedToken`, `partyAuthConsent`, `authenticationDomain`, `role`,
`paymentCardManagement`, `paymentCardRegistry`, `payoutAccountArrangement`, `cardTransactionLog`,
`cardAuthorizationRecord`, `recurringMandateProcedure`, `counterpartyArrangement`, `consentAgreement`,
`consentAccessLog`, `merchantAgreementProcedure`, `merchantAgreementEvents`, `paymentOrderProcedure`,
`paymentExecutionProcedure`, `paymentRequestProcedure`, `paymentRequestEvent`, `paymentLinkRecord`,
`qrPaymentRepresentation`, `checkoutSessionLog`, `notification`, `balanceCreditLog`, `counters`,
`idempotencyKey`, `rtpAliasDirectoryCache`, `cardEtokenProcedure`.

**Integration / EDA infrastructure (hub core, cross-cutting):**
`externalProviderArrangement`, `externalProviderArrangementPortfolio`,
`externalProviderArrangementActionLog`, `capabilityModuleConfiguration`, `businessProcessEvent`,
`complianceProcessEvent`, `domainEvent`.

**Module-owned (replaceable / extractable to a microservice):**
- `card-issuer`: the **CVK** in the key vault (base v30) and the **`cardIssuerVault`** collection (issuer
  CDE) holding the full PAN (QE:equality) plus `cardServiceCode` (QE:equality). BIAN control record:
  Card Administration (confirmed, not invented). This is the **first module with owned data** and the
  reference example of PCI scope containment: disabling the module (or routing the capability to an
  external provider) leaves the core descoped for the PAN, which keeps only token + BIN + last 4.
- Other modules (fds, aml, hrp, kyc, kyb, credit-bureau, card-authorization, account-information,
  payment-initiation, vop): stateless today (only config in `capabilityModuleConfiguration`); their
  verdicts project onto core collections (e.g. `customerCreditRatingState`). The module computes, the
  core persists; each is replaceable by an external provider without touching the core.

**Ports (Hexagonal, cross-frontier):**
- **Card Reference port:** `card-issuer` reads `paymentCardManagement` (token, expiry, status, funding
  account); on extraction it becomes an API / event.
- **Funding Account port:** resolve `payoutAccountArrangement` from a card (validation + cross-linking).
- **Card-by-account port:** `account-information` lists cards by funding account (reuses
  `getCardsByFundingAccount`).

`paymentCardManagement` / `paymentCardRegistry` stay **core** (cards-on-file needed to process payments
with any issuer); the card-issuer module depends on them by port, it does not own them.

**Consequences:** The extraction path for each module is explicit. The card-issuer PAN vault demonstrates
scope containment (the CHD lives only in the module-owned CDE). The trade-off is a documented module→core
coupling via ports, acceptable in the demo monolith and replaceable by API / event on extraction.

*Added 2026-07-22 (v30; doc + code together per repo rules).*

---

## ADR-044: Realistic per-card CVV (issuer CVK) + module-owned PAN vault (v30)

**Status:** Accepted (2026-07-22).

**Context:** The card-issuer engine accepted a single global CVV (`123`). To hold up in expert
conversations the CVV should behave as a real issuer computes it (derived per card from a secret issuer
key in an HSM), and MongoDB's encryption story (QE, envelope encryption, SAD non-persistence) should be
demonstrated on genuine issuer data. Storing the full PAN was requested as an optional issuer feature
without pulling the PSP core into PCI scope.

**Decision:**
1. **Per-card CVV derivation.** `cvv = truncateDigits( HMAC-SHA256( CVK, cardToken | expiryMMYY |
   serviceCode ), cvvLength )`, `cvvLength` per network (Visa/MC = 3, Amex = 4). Derived on demand in
   validation and reveal; **never stored** (PCI DSS Req 3.2, SAD). A **global escape-hatch** CVV
   (`validCvv`, default `123`) remains for fast demos, selected by `cvvMode` (`both` default | `global` |
   `per_card`).
2. **CVK envelope encryption.** The Card Verification Key is module-owned issuer key material, provisioned
   once and stored only wrapped: KMS/master → DEK (key vault) → CVK (HKDF from the unwrapped DEK). Cleartext
   CVK exists only in process memory. Demonstrates the KMS → DEK → secret chain.
3. **Module-owned PAN vault.** The full PAN lives only in `cardIssuerVault` (QE:equality), never in the
   core. `cardServiceCode` (a CVV derivation input, not full track data) is also QE:equality in the vault.
   The core keeps token + `paymentCardBin` (first 6, non-CHD) + `paymentCardLast4` (non-CHD); the persisted
   `paymentCardMaskedPanDisplay` is removed and derived on the fly (`deriveMaskedPan`). The
   `cardTransactionLog` snapshot is untouched.
4. **Search.** Day-to-day search is plaintext on the non-sensitive core: `last4` (equality) + `bin`
   (prefix). Exact PAN lookup uses QE:equality on the vault (`panExact`). Substring / suffix QE is **off**
   (equality only, compatible with server 8.0; avoids the 8.2 pin risk).
5. **Reveal on demand (eye-icon pattern, like IBAN).** PAN and CVV are hidden by default and revealed
   ephemerally, audited (`card.pan.revealed` / `card.cvv.revealed`). `operations_officer` reveals directly
   from the built-in admin console (`GET /modules/card-issuer/cards/:id/{cvv,pan}`,
   `cards:manage` + `requireInternalProvider('card_issuer')`); the card owner reveals via the provider flow
   (`dispatchProvider('card_issuer', 'card.{cvv,pan}.reveal.requested')`), never directly to the module.
   409 `managed_externally` when an external provider governs the capability. Step-up MFA/SCA in production.

**Consequences:** The CVV is realistic and PCI-honest (derived from the PCI-safe token as the HSM analogue,
never persisted). The PAN is CHD only inside the module-owned CDE, so removing the module descopes the core
(ADR-043). Changing the vault's QE fields requires `--reset` + reseed. No new `viewSensitive` permission is
added: `cards:manage` + mandatory audit is the gate.

*Added 2026-07-22 (v30; doc + code together per repo rules).*

---

## v31 ADRs: KYC/KYB Administration, Beneficial Owners, Onboarding Orchestration

### ADR-043: KYB Beneficial Owners as a bounded SD-13 Party-role embed
Context: KYB requires 1..N shareholders with numeric ownership and a controlling person (UBO), FATF/4th
AMLD. Decision: model owners as Party (SD-13) roles referenced from the Merchant Agreement (SD-89), as a
bounded embedded array `merchantBeneficialOwners` on `merchantAgreementProcedure` (subset pattern, hard
cap 25). PII stays in `party` (QE tiers); the embed holds only FK + role + numeric ownership/control
metadata (GDPR Art. 5). Rationale: embedding keeps merchant read, ownership scoping, and owners list all
single-document/single-collection (no `$lookup` fan-out on the hot merchant path); the reverse lookup
"which merchants does this party own" is a multikey index match. The legacy scalar
`merchantOwnerPartyReference` is kept as a derived pointer to the primary (back-compat). Consequence: no
new collection; QE map unchanged; ownership CRUD is a single atomic document update with optimistic
concurrency (`recordUpdatedDateTime` guard).

### ADR-044: KYC/KYB Administration gated by the data resource (SoD)
Context: KYC/KYB administration edits customer PII and merchant/owner data, which crosses into the
`customers`/`merchants` data resources. Decision: Administration is gated by the DATA resource
(`customers`/`merchants`), Configuration by `modules`. `operations_officer` gains
`customers:[view,manage]` + `merchants:[view,manage]`. The KYB DECISION (approve/reject/suspend) stays
with `merchant_officer`; the Operations Officer does DATA CORRECTION only. Both emit the same compliance
events; the split is procedural and recorded in the audit `actorPartyReference`. Rationale: avoids a
"modules can edit any business data" bypass (itself an SoD anti-pattern) and keeps a single permission
model. The Administration PATCH endpoints reject any status/verdict write (400), preserving decision vs
correction separation (PCI Req 7).

### ADR-045: Onboarding decision mode is a built-in-module policy, not a provider signal
Context: whether onboarding auto-resolves or needs a human is a PSP policy, not the vendor. Decision:
`decisionMode` (manual/automated/assisted) + thresholds live in `capabilityModuleConfiguration.moduleConfig`
per capability, edited from the Configuration tab. The provider returns evidence; the PSP decides how it
resolves. Unset defaults to manual (fail-safe). Hard guardrail: sanctions/PEP hit never auto-approves;
`assisted` keeps a human confirmer (EU AI Act / GDPR Art. 22 HITL); every automated/assisted decision is
logged with the rule/recommendation and the confirming actor. If externalized, the decision engine is
reached only via `dispatchProvider`.

### ADR-046: KYB onboarding orchestration (events only) and the zero-orphan stateless engine
Context: KYB had no bus chain (manual only). Decision: mirror the KYC pattern with an events-only fan-out:
`merchant.validation.requested` bridges to kyb+hrp+aml (entity) and per-owner kyc (owner layer); a
`KybVerificationSaga` (scatter-gather keyed by `correlationId`) composes the two-layer verdict, persists
it, and resolves per `decisionMode`. Every provider is reached only via `dispatchProvider`, so replacing
the built-in engine with an external subsystem needs zero reactor changes (set
`externalProviderApiEndpoint` on the arrangement; async vendor responses arrive via the existing callback
handlers). The built-in KYC/KYB engines own no collections (stateless ports; only durable state is the
`capabilityModuleConfiguration` row) — the zero-orphan property (see technical-spec section 10). This
lineage extends ADR-011 (Internal-First) and ADR-025 (endpoint-first dispatch).

### ADR-047: One deterministic verdict-to-status mapper per process
Context: `applyKycScreeningVerdict` wrote the verdict but never advanced the BQ:Step status; the status
was set only by the seeder or the external callback (uncoordinated paths, potential drift). Decision:
introduce shared pure mappers `deriveKycCheckStatus`/`deriveKybCheckStatus`
(`shared/models/onboardingDecision.ts`) called by BOTH the internal saga path and the external callback
path, so status is always derived from the verdict the same way. `applyKycScreeningVerdict` and the new
`applyKybScreeningVerdict` set verdict + BQ:Step status in the same atomic single-document update.
Idempotent (deterministic). Only BIAN BQ:Step vocabulary (initiated/verified/rejected/expired); no
`passed`/`failed`/`pending` as a lifecycle status (ADR-009).

*Added 2026-07-24 (v31; doc + code together per repo rules). Version 2.5.0.*


## v32 ADRs: worker-role visibility, defense in depth, identity-document reconciliation

Context: three defects found while reviewing what a `security_auditor` actually sees. (1) The
beneficiary list was an unfiltered cross-party enumeration issued automatically on page load.
(2) The government identity document was stored twice, and the surfaces the auditor used rendered
the deprecated, unsearchable copy. (3) Four different mask/reveal mechanisms coexisted, so the eye
icon meant something different on each page and the auditor had *less* friction than the operations
officer on identical QE:none fields.

### ADR-048: search-first, no enumeration for oversight roles

**Decision.** Worker roles reach counterparty data through an identifier-constrained search and a
party/case drill-down, never through a standing unfiltered list. The rule lives in the domain
service (`assertBeneficiaryPredicate`), not in the controller and not in the page, so a future caller
cannot bypass it. A cross-party read additionally requires a capability that first-line triage does
not hold.

**Reuse over catalog growth.** `ACTIONS` is a deliberately static four-tuple mirrored in the backend
catalog, the frontend mirror, the action labels, the E2E permission stub, the role-matrix editor and
the help pages. Rather than adding a fifth action, the existing `investigate` action is reused on the
`beneficiaries` resource: `view` is drill-down for a known owner, `investigate` is cross-party
search. Only role grants changed; the catalog did not.

**Rationale.** PCI DSS v4.0.1 7.2.6 ("allowed actions based on user roles"), 7.3.1 (need to know),
7.3.3 (deny all by default), 10.2.2 (the log names the affected data); GDPR Art. 5(1)(c) and
Art. 25(2) (purpose-necessary *by default*); EBA/GL/2019/04 §31(a), whose stated objective is to
"prevent unjustified access to a large set of data"; ISO/IEC 27001:2022 A.8.3; NIST SP 800-53 AC-6.
Precedent: Garante v. Intesa Sanpaolo, EUR 31.8m, 30 March 2026, where the finding was an operational
model that let operators query the entire customer base. Homologous design: Adyen ships
"View Payments" as *search pages* by default and keeps PII and export behind separate additive roles.

**Consequence.** Bulk needs are served by aggregate endpoints that return counts with no
identifiers, plus a per-record disclosure event so the audit trail is per record rather than per
screen. Honest framing: no single clause forbids a list view; the case is cumulative.

### ADR-049: additive PII and export capabilities

**Decision.** Unmasked counterparty and identity PII, and bulk extract, are separate capabilities and
are never implied by a read role. The display-safe projection applies to **every** channel, not only
the OAuth one: the counterparty party reference and the raw lookup value never appear in a list
response, on any channel. Reading a single record and extracting a population are different acts.

**Rationale.** PCI DSS 7.2.6; ISO 27001 A.8.2; Adyen's separation of *Export Payments* from
*View Payments*.

### ADR-050: one physical field per logical datum, one projection per aggregate

**Decision.** `customerAgreementGovernmentID` is the single source of truth for the identity
document. `governmentIdentificationReference` is legacy read-only: never written (removed from the
generator and from all 56 fixtures, with a `$unset` in the seeder for databases seeded earlier),
never read, never present in a response. `buildResponse()` remains the only customer projection.

**Rationale.** A displayed value that cannot be searched is both a usability defect and an audit
defect: the disclosure event named only the deprecated field, so reading the real identity document
produced no `field_accessed` record (PCI DSS 10.2.1.1 / 10.2.2). Keeping one projection is what makes
the cross-role visibility matrix mechanically enforceable.

### ADR-051: demo behavior by configuration, default-secure

**Decision.** Demo simplifications are expressed only as documented configuration flags that default
to the production behavior, may widen *presentation* but never *access*, and announce themselves in
the UI. `PSP_QE_TEXT_SEARCH` is the reference implementation: it reflects a real cluster capability,
degrades the three text modes to equality on both the schema and the query side, and tells the
audience it did so. A kill-switch is not authorization: `PSP_DEMO_RAW_DOCUMENTS` may remove the raw
document surface but may not be the thing that prevents a cross-party read.

### ADR-052: one reveal contract, tier decides masking and role decides success

**Decision.** A sensitive-tier (QE:none) value belonging to another party never travels in a list or
detail payload; it is obtained only from a reveal endpoint that emits one compliance event per
disclosure. Lookup-tier values render directly with their QE mode in the field help, because that is
the searchable surface the demo exists to show.

Two components, never interchangeable:
- `SensitiveReveal`: the value is not in the payload; the eye performs a server round-trip that is
  audited. An access control.
- `DisplayMask`: the caller already holds the value (own record under GDPR Art. 15, or a lookup-tier
  attribute). Hiding it is a screen-sharing convenience and its tooltip says so.

Reviewer's rule: if hiding the value is the reason it is safe, `DisplayMask` is the wrong component.
Raw and debug panels are not disclosure channels: one shared formatter previews ciphertext as hex and
redacts sensitive-tier keys by name at any depth.

**Rationale.** PCI DSS 10.2.1.1 / 10.2.2; EBA §31(d); ISO 27001 A.8.15; NIST AC-6(9); and the
principle that a value already in the browser is disclosed regardless of what the UI hides.

### ADR-053: one canonical customer record view, share the composition not the admin route

**Decision.** Customer information is rendered from one shared set of permission-aware record
primitives (`RecordField`, `RecordGroup`, `IdentityDocumentBlock`), and each role uses the route it
legitimately owns: `/system/users/[customerId]` for investigation and oversight,
`/system/admin/modules/kyc/[partyInstanceReference]` for KYC administration. Access level decides how
many groups a caller receives, never how the record looks.

**Rejected alternative.** Granting investigation roles `modules:view` so they could reuse the admin
KYC route. That would widen those roles into every other admin module as a side effect, which is a
least-privilege regression (PCI DSS 7.2.2, EBA §31(a)) introduced for a UI convenience.

*Added 2026-07-29 (v32; doc + code together per repo rules).*

### ADR-054: the data generator is additive and refuses to clobber

**Decision.** `bin/seed-generate.ts` reads the existing `backend/data/*.json`, keeps every record it
finds byte-for-byte, and only appends what is needed to reach its target floors. `write()` refuses to
reduce any collection's record count and fails the run unless `--force` is passed. A second run over
its own output is a no-op, so the generator is safe to invoke at any point in the lifecycle.

**Context.** The generator produced 50 customer parties, 3 employee parties and 5 logins. The fixtures
had been curated up to 57, 11 and 20 across many iterations, and `ensureDataFiles()` only runs the
generator when the files are **absent**, so the drift was invisible. Anyone running
`npm run generate:data` would have silently deleted 8 staff parties, most of the curated login roster
and the demo cast the storyline depends on.

**Rejected alternative.** Bringing the generator up to the fixtures, by encoding the 57 customers, the
11 employees and the 20 curated logins in the generator so its output equals the current files. It is
cleaner conceptually, and it is exactly what caused the drift: it hard-codes curated demo content into
a generator, so the two must then be kept in step by hand forever. Additive inverts the dependency:
curated content lives only in the fixtures, and the generator's job is to top up a synthetic
population, never to own the cast.

**Consequence.** The fixtures are the source of truth for the population, so the population invariants
are asserted against them (`seedDataIntegrity.test.ts`) rather than against a live database, and the
shared repairs in `vendors/seed/dataIntegrity.ts` are applied by both the generator and the runtime
seeders. Growing the demo means editing a fixture or raising a floor, never rewriting the generator.

*Added 2026-07-29 (v33; doc + code together per repo rules).*

### ADR-055: a shared card token is a compliance signal, not a duplicate key

**Decision.** `paymentCardManagement.paymentCardReference` is deliberately **not** unique. Uniqueness
is on the pair `(customerAgreementInstanceReference, paymentCardReference)`: the SD-88 control record
is the per-customer card-on-file *arrangement*, and one physical card may legitimately be on file for
several customers. The distinct-holder count is materialized in `paymentCardRegistry.cardHolderCount`
and is the FDS/AML shared-card signal (a count above three trips the compliance indicator and is
surfaced to the cardholder as "this card is also on file for N other people").

**Context.** The v33 audit read the two multi-holder tokens (`pm_shared00000a4153` on 5 arrangements,
`pm_shared00000b8821` on 2) as a duplicate-key defect and proposed regenerating them plus a unique
index on the token alone. That would have deleted the shared-card capability: the seeded holders are
the only population the signal has to fire on.

**Consequence.** The token is a PAN surrogate, so a token-only lookup is inherently ambiguous when a
card is shared. `getCardByToken` therefore documents itself as a best-effort global check and takes an
optional `customerRef` for the correct per-customer view. Where the seed must resolve a token to one
holder (repointing a transaction to its card, v33 F3), it prefers a token unique to that holder, so the
transaction surfaces stay unambiguous while the shared-card demo keeps its population.

*Added 2026-07-29 (v33; doc + code together per repo rules).*

### ADR-056: the commission is withheld from the gross and credited to a PSP revenue ledger (v34)

**Status.** Accepted.

**Context.** ADR-041 modelled the commission (SD-65 `feeAmount` + `fee` attribution, SD-89
`merchantCommissionRate`) and deferred the runtime wiring as A-06. Half of it later landed: the
acquiring path persisted `feeAmount` at authorization and emitted `merchant.commission.collected`.
The other half never did. The payout path created every execution with `feeAmount: 0`, so
`netAmount == grossAmount`, and settlement credited the merchant the full gross. The only
`gross − fee` formula in the repo had no caller. The result was a one-sided ledger: an event and an
aggregation claimed revenue while no account was debited and none was credited, and the merchant UI
displayed a commission figure that changed no amount.

**Decision.**

1. **Withheld, not added.** The buyer is charged the gross, which is what a PSP does: the fee is taken
   out of the merchant's proceeds. `resolveMerchantFee` turns the merchant's current rate into the
   gross/net/fee triple *before* the execution is inserted, so the record is correct at birth rather
   than corrected by a second write. The replaced `applyMerchantFee` (post-hoc patch, never called) is
   removed. The rail is asked to move `netAmount`; the commission never leaves the PSP.
2. **Zero is the safe default.** No configured rate, or one outside 0..1, yields `feeAmount 0`, no
   `fee` sub-document and `netAmount == grossAmount`, with no balance movement at all. Callers can
   apply the result unconditionally, so an operation that states no fee can never unbalance a ledger.
3. **The fee has a holder.** A PSP revenue ledger receives it: an SD-13 party of type
   `service_account` holding an SD-66 `internal_ledger` account, seeded deterministically. No new
   collection and no new model, because the PSP is a party like any other holder. `postCommission`
   makes the posting double entry (merchant `pendingAmount −= fee`, PSP `availableAmount += fee`)
   composing the existing balance primitives, and mirrors it into `balanceCreditLog` with a new
   `commission` credit type plus a `merchant.commission.settled` event (PCI DSS Req 10). The credit id
   is derived from the execution, so it is also the idempotency gate. `commission` is deliberately
   absent from the admin credit endpoint's enum: it is system-posted only.
4. **The hold clears exactly.** The authorization hold is taken on the gross, so the fee leg is
   derived as `grossConverted − netConverted` in the merchant account currency instead of being
   converted on its own. Otherwise FX rounding would strand a cent in `pendingAmount` forever.
   For the same reason the buyer's funding hold is released against `grossAmount`, not the settled net.
5. **Revenue counted once.** A card-originated execution now carries the same fee as its acquiring
   record, so the execution source of `commissionRevenue` is restricted to fees with no acquiring
   counterpart. Settlement amounts are read from our own execution record rather than from the rail
   payload, so the ledger cannot drift from what we stored.

**Consequences.** BIAN-pure (SD-65 execution, SD-66 balances, SD-89 pricing, SD-13 party) with no new
collection. The demo can now show the full picture: the buyer pays the price, the merchant receives
the net, the PSP holds the commission, and `balanceCreditLog` explains every cent of that balance.
Accounting never blocks a payment and never strands an amount: `postCommission` returns a typed
outcome, and on a missing revenue ledger the caller releases the fee to the merchant, since the hold
was taken on the gross and would otherwise keep it in `pendingAmount` forever. The PSP forgoes the fee
rather than holding money belonging to nobody; a replay needs no compensation. Trade-off: the two legs are
separate single-document `$inc` operations rather than one transaction, consistent with the rest of
the ledger in this demo, so a crash between them is repaired by the credit-log reconciliation rather
than rolled back.

*Added 2026-07-30 (v34; doc + code together per repo rules).*
