# EP: FSI PCI DSS Payment Security Demo

## Status

Draft  
Version: 1.2: Author: Antonio Membrides Espinosa: Last updated: 2026-06-08  
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

customerAgreement ──1:1──► customerAgreementSensitive
       │
       │ 1:many (via customerAgreementInstanceReference, plaintext)
       ▼
paymentCard  ──────────────────────────────────────────────────────┐
       │ (via paymentCardReference token, standard index)            │
       │ many:1                                                      │
       ▼                                                             │
cardTransaction ──1:1──► cardTransactionSensitive                │
       │                                                             │
       │ 1:many                                                      │
       ▼                                                             │
fraudDiagnosisCase ◄── also links ───────────────────────────────────┘
   (linkedCustomerAgreementReference + linkedCardTransactionReference)
```

**Payment token (paymentCardReference):** Stored as plaintext with a standard MongoDB index — not in QE. A payment token is a card surrogate under PCI DSS v4.0: it is not Cardholder Data (CHD) and does not require QE protection. QE equality applies only to genuine PII/CHD fields (`customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`, `customerAgreementReference`).

**Join strategy:** Application-side sequential queries. The backend service layer queries each collection independently and assembles the response. No `$lookup` across QE collections: it is not supported for encrypted fields in the current QE implementation.

**QE collection split rationale:** QE requires all encrypted fields in a collection to be defined in the `encryptedFieldsMap` at collection creation time. Mixing equality-searchable and non-searchable (`none`) fields in one collection is permitted, but separating lookup collections from sensitive collections makes the access-control boundary explicit: Level 1 queries only the `*QE` lookup collections; Level 2 additionally queries the `*SensitiveQE` collections after escalation.

### 3.4 Queryable Encryption design

Two DEKs:

| DEK | Wraps | Collections | Access |
|---|---|---|---|
| `DEK-lookup` | AWS CMK | `cardTransaction`, `customerAgreement`, `paymentCard`, `partyAuthentication` | All service roles |
| `DEK-sensitive` | AWS CMK | `cardTransactionSensitive`, `customerAgreementSensitive` | Level 2 + escalation token only (v2) |

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
| `customer` | SD-53 · SD-88 | Customer Agreement · Payment Card | `customerAgreement` · `customerAgreementSensitive` · `paymentCard` | `equality` on email / phone / accountRef · `none` on address / govId / expirationDate | `/api/v1/customer` · `/api/v1/customer/:id/cards` | **In scope** — PII/CHD |
| `transactions` | SD-254 | Card Transaction | `cardTransaction` · `cardTransactionSensitive` | `equality` on accountRef · `none` on rawGatewayPayload | `/api/v1/transactions` | **In scope** — CHD |
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
  │     └── imports createFraudCase ──────────────────────────────────────────┐
  ├── modules/fraud/                  SD-83  ◄──────────────────────────────┘
  │
  ├── modules/gateway/ [v4]           SD-64 + SD-65 + SD-89 + SD-57
  │     └── imports triggerFraudEvaluation ──► shared/services/fraudTrigger ──► modules/fraud/
  │
  └── modules/system/                 demo infra (NODE_ENV !== 'production' only)

shared/models/   ←── imported by any module that needs the type (no runtime cost)
vendors/encryption/  ←── imported by QE-enabled modules only
```

PCI CDE boundary at code level: modules `customer`, `transactions`, and `gateway` (v5) are in scope. `fraud` and `identity` are adjacent. `system` is non-CDE. This mirrors the network segmentation principle in [payment_gateway.md §7.2](payment_gateway.md).

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
