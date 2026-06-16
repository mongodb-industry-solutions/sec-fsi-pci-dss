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
| Seed data accidentally includes real PAN format | Medium | High | Seed generator always prefixes tokens with `tok_`; grep CI check rejects any string matching `\b\d{13,19}\b` |
| Key vault DEK reference lost (collection dropped without DEK cleanup) | Low | High | `bin/setup.ts --reset` drops collections then recreates DEKs; order is enforced in script |
| Demo breaks at conference due to AWS KMS unavailability | Low | High | Local KMS fallback is always available with `KMS_PROVIDER=local`; test it before travel |

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
| Card data isolation | Raw card numbers never sent to or stored by the API; client-side tokenization (`tok_<random>`) |
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
- **Curated roster flag.** `customerAuthenticationDemoFeatured: boolean` marks the curated set (4 customers incl. the simulator merchant owner, 2 L1, 2 L2, 2 auditors, 2 merchant officers, 1 manager). `GET /api/v1/auth/users?featured=true` (and `/system/users`) returns it; the debug-mode picker and Simulator consume it. The full seed stays intact for ad-hoc testing. Emails unified to `@back.es`. `users.json` deleted (dead).
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

**Consequences.**
- (+) Structured, auditable customer interaction; every question and response is timestamped and attributed (Req 10).
- (+) Immutable answers (no edit after submit) give a defensible investigation record.
- (+) Reuses the existing case/events/RBAC/notes architecture; no parallel system.
- (−) One new collection + a small notifications surface to maintain.
