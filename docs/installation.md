
## Quick Start

### Prerequisites

- Node.js 20 LTS or higher
- Docker + Docker Compose
- MongoDB Atlas cluster (M10 or higher — free tier does not support Queryable Encryption)
- AWS KMS key **or** `KMS_PROVIDER=local` for offline development (see §1)

---

## 1. Configure Environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | Yes | Atlas connection string (`mongodb+srv://...`) |
| `MONGODB_DB_NAME` | Yes | e.g. `pci_dss_demo` |
| `KMS_PROVIDER` | Yes | `aws` (default) or `local` (offline dev) |
| `LOCAL_MASTER_KEY_BASE64` | When `KMS_PROVIDER=local` | Generate: `node -e "require('crypto').randomBytes(96).toString('base64')"` |
| `AWS_ACCESS_KEY_ID` | When `KMS_PROVIDER=aws` | IAM user with KMS Decrypt permission |
| `AWS_SECRET_ACCESS_KEY` | When `KMS_PROVIDER=aws` | — |
| `AWS_CMK_ARN` | When `KMS_PROVIDER=aws` | ARN of your Customer Master Key |
| `AWS_REGION` | When `KMS_PROVIDER=aws` | e.g. `us-east-1` |
| `JWT_SECRET` | Yes | Generate: `node -e "require('crypto').randomBytes(32).toString('hex')"` |
| `NEXT_PUBLIC_API_URL` | Yes | `http://localhost:3001` for local dev |

### Local KMS (no AWS required)

```bash
# Generate LOCAL_MASTER_KEY_BASE64 (paste into .env)
node -e "require('crypto').randomBytes(96).toString('base64') |> console.log"
# or
node -e "console.log(require('crypto').randomBytes(96).toString('base64'))"
```

Set in `.env`:

```bash
KMS_PROVIDER=local
LOCAL_MASTER_KEY_BASE64=<your-generated-key>
```

---

## 2. Install Dependencies

```bash
npm run install:all
# Installs root + frontend + backend node_modules
```

---

## 3. Set Up the Database

```bash
npm run setup:db   # Creates QE collections, key vault, indexes — run once per cluster
npm run seed       # Inserts synthetic BIAN-compliant demo data (idempotent)
```

> **Note:** `setup:db` requires a live Atlas cluster with QE-compatible tier (M10+) and valid KMS credentials.

---

## 4. Start the Application

```bash
# Option A: Development mode with hot reload (recommended)
npm run dev
# Starts backend on :3001 and frontend on :3000 concurrently

# Option B: Docker Compose (full containerised stack)
docker compose up
```

Open [http://localhost:3000](http://localhost:3000) to view the demo.

---

## 5. Running the Tests

The test suite is organised in three levels following the IST demo testing pyramid. All tests live in `test/` at the repository root.

```
test/
├── setup.ts                        ← global Vitest setup
├── backend/
│   ├── unit/services/              ← service layer — mocked DB, no Atlas required
│   └── integration/routes/         ← API routes — requires TEST_MONGODB_URI
└── frontend/
    ├── unit/lib/                   ← auth helpers, constants, API client
    └── e2e/                        ← Playwright browser flows
```

### 5.1 Unit tests

Run against mocked dependencies — **no Atlas connection required**.

```bash
npm run test:unit
# Runs Vitest on test/backend/unit/ and test/frontend/unit/
```

What is covered:

| File | What it tests |
|---|---|
| `test/backend/unit/services/auth.service.test.ts` | JWT signing, bcrypt compare, 401 cases, no password hash in response |
| `test/backend/unit/services/cardTransaction.service.test.ts` | Fraud trigger logic, threshold env var, Level-1 field stripping |
| `test/backend/unit/services/customerAgreement.service.test.ts` | QE field stripping from response, search predicate correctness |
| `test/backend/unit/services/paymentCard.service.test.ts` | Card creation, ADR-003 token stored as surrogate |
| `test/backend/unit/services/fraudDiagnosis.service.test.ts` | Case creation, audit log entry, pagination filters |
| `test/frontend/unit/lib/auth.test.ts` | Cookie read/write/clear, JWT decode, expiry check |
| `test/frontend/unit/lib/constants.test.ts` | All 5 demo users defined, role labels, severity/status color maps |

### 5.2 Integration tests

Spin up a real Fastify app against a test Atlas cluster with QE active.

**Requires `TEST_MONGODB_URI` to be set** — tests skip gracefully when the variable is absent, so CI can run without Atlas.

```bash
# Set the test cluster URI (separate from your demo cluster is recommended)
export TEST_MONGODB_URI="mongodb+srv://..."
export TEST_MONGODB_DB_NAME="pci_dss_test"

npm run test:integration
# Runs Vitest on test/backend/integration/ and test/frontend/integration/
```

What is covered:

| File | FR coverage |
|---|---|
| `test/backend/integration/routes/auth.test.ts` | FR-v1-05: login 201/401, user list, auth guard, public routes |
| `test/backend/integration/routes/cardTransaction.test.ts` | FR-v1-03/04: POST transaction, fraud auto-creation (amount + MCC), GET by ID (Level-1 projection), POST card, GET cases paginated |

### 5.3 Run unit + integration together

```bash
npm test
# Equivalent to: npm run test:unit && npm run test:integration
```

### 5.4 Watch mode (during development)

```bash
npm run test:watch
# Vitest reruns affected tests on every file save
```

### 5.5 E2E tests (Playwright)

Browser-driven tests covering the primary demo flows. **Requires the frontend dev server** — Playwright starts it automatically when running locally.

```bash
# One-time browser install (first run only)
npx playwright install chromium

# Run all E2E tests
npm run test:e2e

# Interactive UI mode (recommended for debugging)
npm run test:e2e:ui

# Debug a single test with browser inspector
npm run test:e2e:debug
```

What is covered:

| Spec file | Flow |
|---|---|
| `test/frontend/e2e/simulator-payment.spec.ts` | FR-v1-01: Simulator 3-step checkout, card masking, PCI DSS note, fraud alert |
| `test/frontend/e2e/simulator-investigation.spec.ts` | FR-v1-02: Search by QE field, case table, case detail, encryption badges, raw document toggle |
| `test/frontend/e2e/demo-auth.spec.ts` | FR-v1-05: Login, role-based redirect (analyst → investigation, customer → payment), auth guard, sign out |
| `test/frontend/e2e/demo-payment.spec.ts` | FR-v1-03: Authenticated checkout, fraud alert on creation, error state |
| `test/frontend/e2e/demo-investigation.spec.ts` | FR-v1-04: Case table, severity badges, case detail, audit log, raw document toggle |

**E2E against staging:**

```bash
BASE_URL=https://my-demo.staging.example.com npm run test:e2e
```

### 5.6 Full test suite (all levels)

```bash
npm test && npm run test:e2e
```

### 5.7 CI quality gate

Before merging or releasing, confirm:

- [ ] `npm test` passes with zero failures
- [ ] Every non-trivial service function has a unit test
- [ ] Every API route has an integration test covering the happy path
- [ ] Primary demo flow covered by an E2E test
- [ ] At least one error state covered by an E2E test

---

## 6. Available Commands Reference

| Command | Description |
|---|---|
| `npm run install:all` | Install root + frontend + backend dependencies |
| `npm run dev` | Start frontend and backend concurrently (hot reload) |
| `npm run dev:frontend` | Start only the Next.js frontend (:3000) |
| `npm run dev:backend` | Start only the Fastify API (:3001) |
| `npm run build` | Build frontend and backend for production |
| `npm run setup:db` | Create QE collections, key vault, indexes |
| `npm run seed` | Insert synthetic demo data (idempotent) |
| `npm test` | Run unit + integration tests (Vitest) |
| `npm run test:unit` | Unit tests only — no Atlas required |
| `npm run test:integration` | Integration tests — requires `TEST_MONGODB_URI` |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run test:e2e:ui` | Playwright interactive UI |
| `npm run test:watch` | Vitest watch mode |

---

## 7. Debugging

VS Code debug configurations are provided in `.vscode/launch.json`:

| Configuration | What it does |
|---|---|
| `Backend: Debug (ts-node-dev)` | Launches Fastify with `--inspect` on port 9229 |
| `Frontend: Debug Next.js` | Launches Next.js with `--inspect` on port 9230 |
| `Full Stack: Backend + Frontend` | Compound — starts both simultaneously |
| `Backend: Run Jest Unit Tests` | Runs `test:unit` with the VS Code debugger attached |
| `Backend: Run Jest Integration Tests` | Runs `test:integration` with the VS Code debugger attached |
| `Backend: Attach to Running (port 9229)` | Attach to an already-running backend process |
| `Frontend: Attach to Running (port 9230)` | Attach to an already-running Next.js process |

Set breakpoints in any TypeScript source file and launch the relevant configuration from the **Run and Debug** panel (`Ctrl+Shift+D` / `⇧⌘D`).
