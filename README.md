# FSI PCI DSS Payment Security Demo

> A MongoDB IST demo that shows how a digital bank or card issuer can run a complete card payment lifecycle — from checkout to fraud investigation — while keeping sensitive cardholder data encrypted end-to-end.

**Core message:** *Encrypt everything. Query anything. Keys are yours.*

---

## What This Demo Shows

A synthetic digital bank uses **MongoDB Queryable Encryption (QE)** with **AWS KMS** to protect cardholder data. The server stores only ciphertext. Fraud analysts still search encrypted fields by email, phone, account reference, or card token — without server-side decryption. Access is controlled by role. Every action is audited.

This answers the most common FSI prospect question:

> *"How can we keep payment data fully encrypted and still run fraud investigations at speed?"*

---

## Key MongoDB Capabilities Demonstrated

| Capability | What the Demo Shows |
|---|---|
| **Queryable Encryption — equality** | Search encrypted email, phone, account reference, card token |
| **Queryable Encryption — none mode** | Protect address and government ID; reveal only under escalation (v2) |
| **AWS KMS integration** | Customer-controlled master key; MongoDB has zero access |
| **RBAC** | Level 1 Analyst vs Level 2 Investigator field visibility (v2) |
| **Atlas Audit Log** | Per-field access trail in the investigation workflow (v2) |
| **TLS 1.3** | All Atlas connections encrypted in transit by default |

---

## Regulatory Alignment

- **PCI DSS v4.0** — MongoDB Atlas certified September 2023
- **BIAN** (Banking Industry Architecture Network) — data model follows BIAN Service Domain naming conventions

---

## Demo Flow

```
Customer pays with credit card
        ↓
Fields encrypted client-side before reaching MongoDB Atlas
(paymentCardReference, customerEmailAddress, customerMobilePhoneNumber, ...)
        ↓
Suspicious transaction triggers a Fraud Diagnosis Case
        ↓
Level 1 Analyst searches by encrypted email — finds the record
MongoDB server never decrypted the field
        ↓
Analyst escalates → Level 2 Investigator reveals sensitive fields (v2)
        ↓
Complete audit trail: who accessed what, when, under which role (v2)
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router + TypeScript |
| Backend API | Fastify 4 + TypeScript |
| Database | MongoDB Atlas (M10+) with Queryable Encryption |
| Key Management | AWS KMS (local KMS fallback for offline demos) |
| Monorepo | npm workspaces + Turborepo |
| UI Design | LeafyGreen Design System |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- MongoDB Atlas cluster (M10 or higher)
- AWS KMS key (or use `KMS_PROVIDER=local` for local development)

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env: set MONGODB_URI, AWS_CMK_ARN, and AWS credentials
# For offline/local mode: set KMS_PROVIDER=local
```

### 2. Install and Set Up the Database

```bash
npm run install:full
# Installs dependencies, creates collections with QE schemas,
# provisions encryption keys, creates indexes, and seeds demo data
```

### 3. Start the Application

```bash
# Option A — Docker Compose (recommended)
npm run docker:up

# Option B — Development mode with hot reload
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the demo.

---

## Available Commands

| Command | Description |
|---|---|
| `npm run dev` | Start all apps in development mode |
| `npm run dev:web` | Start only the Next.js frontend |
| `npm run dev:api` | Start only the Fastify API |
| `npm run build` | Build all apps for production |
| `npm run db:setup` | Create collections, indexes, and QE key vault |
| `npm run db:seed` | Insert synthetic demo data |
| `npm run db:seed:reset` | Drop and re-insert all seed data |
| `npm run docker:up` | Build and start full stack with Docker Compose |
| `npm run docker:down` | Stop containers |
| `npm run type-check` | TypeScript validation across all packages |

---

## Repository Structure

```
sec-fsi-pci-dss/
├── apps/
│   ├── web/           # Next.js App Router frontend
│   └── api/           # Fastify REST API
├── packages/
│   ├── db/            # MongoDB QE client, schemas, indexes
│   └── types/         # Shared TypeScript types (BIAN DTOs)
├── bin/
│   ├── setup.ts       # DB setup: collections, indexes, QE key vault
│   └── seed/          # Synthetic BIAN-compliant seed data
├── docs/              # Project documentation
└── docker-compose.yml
```

---

## Documentation

| Document | Description |
|---|---|
| [PRD](docs/PRD.md) | Product Requirements Document — full architecture, BIAN data model, QE design, and 3-iteration roadmap |
| [Q&A: PCI DSS](docs/q&a.md) | Common FSI client questions about MongoDB and PCI DSS compliance |

---

## Data Architecture

The data model follows **BIAN Service Domain** naming conventions across 6 collections:

| Collection | BIAN Service Domain | QE Protection |
|---|---|---|
| `cardTransactionQE` | Card Transaction (SD-254) | equality: card token, account reference |
| `cardTransactionSensitiveQE` | Card Transaction — Sensitive | none: gateway payload, processor metadata |
| `customerAgreementQE` | Customer Agreement (SD-53) | equality: email, phone, account reference |
| `customerAgreementSensitiveQE` | Customer Agreement — Sensitive | none: address, government ID, risk notes |
| `paymentCardQE` | Payment Card (SD-88) | equality: card token; none: expiry date |
| `fraudDiagnosisCase` | Fraud Diagnosis (SD-83) | plaintext — operational metadata only |

> Full schema definitions, field-level QE modes, index strategy, and collection relationships are documented in [docs/PRD.md §6](docs/PRD.md#6-bian-data-architecture).

---

## PCI DSS Alignment

This demo demonstrates a **PCI DSS-aligned reference architecture**. MongoDB Atlas holds PCI DSS 4.0 certification. The customer remains responsible for their own PCI compliance program.

Key PCI DSS v4.0 requirements addressed:

- **Req 3** — Cardholder data encrypted before storage; SAD never stored
- **Req 3.6** — Customer-controlled key management via AWS KMS
- **Req 4** — TLS 1.3 on all Atlas connections
- **Req 7** — Role-based field visibility (v2)
- **Req 10** — Audit log for all field access events (v2)

---

## Roadmap

| Version | Theme | Key Features |
|---|---|---|
| **v1** | Security Foundation | Payment simulation, QE encryption visible, basic fraud investigation |
| **v2** | Investigation & Control | RBAC, escalation workflow, audit trail, KMS key rotation |
| **v3** | Advanced Capabilities | Range queries, save card / recurring payment, Leafy Bank integration prep |

See [docs/PRD.md §9](docs/PRD.md#9-product-roadmap) for the full roadmap.

---

## Disclaimer

This demo uses **synthetic data only**. No real cardholder data, personal information, or production credentials are included. The demo is a reference architecture illustration and does not constitute a PCI DSS compliance certification or legal compliance advice.
