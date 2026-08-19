# 🏦 Sec4 Pay: FSI PSP + PCI DSS + MongoDB

![](./frontend/public/app-logo.png)

> A Payment Service Provider (PSP) solution: a PCI DSS-aligned platform used by digital banks or card issuers to authorize card payments, detect fraud, and investigate cases. It runs the full payment lifecycle on MongoDB Atlas, from checkout and authorization, through automated transaction scoring, to multi-tier analyst investigation and resolution.

**Core message:** *🔐 Encrypt everything. 🔍 Query anything. 🔑 Keys are yours.*

---

## 🎯 What This Demo Shows

A PSP platform uses **MongoDB Queryable Encryption (QE)** with **AWS KMS** to protect cardholder data. The server stores only ciphertext. Fraud analysts still search encrypted fields by email, phone, and account reference: without server-side decryption. Access is controlled by role. Every action is audited.

This answers the most common FSI prospect question:

> *"How can we keep payment data fully encrypted and still run fraud investigations at speed?"*

---

## ⚡ Key MongoDB Capabilities Demonstrated

| Capability | What the Demo Shows |
|---|---|
| 🔐 **Queryable Encryption (equality)** | Search encrypted email, phone, and account reference (PII fields) |
| 🔒 **Queryable Encryption (none mode)** | Protect address and government ID; reveal only under escalation (v2) |
| 🔑 **AWS KMS integration** | Customer-controlled master key; MongoDB has zero access |
| 👤 **RBAC** | Level 1 Analyst vs Level 2 Investigator field visibility (v2) |
| 📋 **Atlas Audit Log** | Per-field access trail in the investigation workflow (v2) |
| 🌐 **TLS 1.3** | All Atlas connections encrypted in transit by default |

---

## 🏛️ Regulatory Alignment

- **PCI DSS v4.0**: MongoDB Atlas certified September 2023
- **BIAN** (Banking Industry Architecture Network): data model follows BIAN Service Domain naming conventions

---

## 🎬 Demo Flow

```
💳  Customer pays with credit card
         ↓
🔒  PAN tokenized in the browser: never transmitted or stored
         ↓
🔐  PII fields encrypted client-side before reaching MongoDB Atlas
     (customerEmailAddress, customerMobilePhoneNumber, cardTransactionAccountReference, ...)
         ↓
🚨  Suspicious transaction triggers a Fraud Diagnosis Case
         ↓
🕵️  Level 1 Analyst searches by encrypted email: finds the record
     MongoDB server never decrypted the field
         ↓
⬆️  Analyst escalates → Level 2 Investigator reveals sensitive fields (v2)
         ↓
📋  Complete audit trail: who accessed what, when, under which role (v2)
```

---

## 🚀 Quick Start

To begin the process of testing, installation, and execution, please follow the instructions in [the installation guide](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki/installation).

### Running both services locally

One `.env` at the repository root configures both. Every bank variable is `PSP_BANKCORE_`-prefixed and
defaults to "same cluster, own database", so the only value you normally have to set is the connection
string you already have.

```bash
npm run setup        # installs every workspace, including bankcore

npm run setup:db     # both databases: collections, Queryable Encryption, indexes, keys
npm run setup:seed   # both, in order
npm run setup:check  # verifies what was just built, on both

npm run dev          # every service at once, or use dev:bankcore / dev:backend / dev:frontend
```

One command covers **both** services. The provider's entry points orchestrate every registered bank from
`backend/data/bankInstances.json`, in the order the data requires: the bank is seeded BEFORE the provider,
because the provider's records point at the bank's and not the reverse, and dropped before it too, because
dropping the provider takes the shared key vault with it. Adding a second bank is a record in that file plus
its own database, not a change to any script.

Rebuilding from nothing is `npm run setup:reset`, which rebuilds both. Reach for it after any change to a
collection, an index, an encrypted field or a data encryption key: setup SKIPS a collection that already
exists, so an encryption change to one already there will not otherwise take effect.

If you do reset one side by hand, note that the bank's collections reference data encryption keys in the
shared vault: a provider reset that drops the vault leaves the bank pointing at keys that no longer exist.
Setup detects exactly that and tells you to rebuild, rather than letting it surface later as a driver error on
the first encrypted read.

`PSP_BANKCORE_ENABLED=false` turns the bank off and restores the provider's built-in engines, which is what
makes a regression one variable away from being isolated.

**Two things that will cost you an hour if you meet them cold.** The bank must load the SAME `crypt_shared`
version the provider does, or the whole database connection fails and reports itself as plain connectivity
trouble. And the bank persists its notification signing key on disk with the `kid` derived from the key, so a
deployment pins one replica: two would each mint their own key, and a receiver holding one JWKS would reject
the other's notifications.

---

## 🗄️ Data Architecture

The data model follows **BIAN Service Domain** naming conventions. The provider's principal collections:

| Collection | BIAN Service Domain | QE Protection |
|---|---|---|
| `partyAuthenticationAssessment` | Party Authentication (SD-16) | equality: user email |
| `cardTransactionLog` | Card Transaction (SD-254) | equality: account reference; QE:none fields (gateway payload, processor metadata) are **inline** in the same document — no separate sensitive collection |
| `customerAgreementProcedure` | Customer Agreement (SD-53) | equality: email, phone, account reference; QE:none: address, government ID |
| `paymentCardManagement` | Payment Card (SD-88) | none: expiry date; card token is plaintext (not CHD) |
| `fraudDiagnosisCase` | Fraud Diagnosis (SD-83) | plaintext: operational metadata only |
| `fraudDiagnosisCaseEvents` | Fraud Diagnosis (SD-83) — audit log | plaintext: immutable event records (notes, escalations, accesses) |
| `party` | Party (SD-13) | equality: PII identifiers |
| `customerAuthenticationAssessment` | Customer Authentication (SD-91) | equality: credential hash |

The bank holds its own: `accountArrangement` (the real balance, IBAN encrypted), `accountMovement` (every
mutation, so the ledger reconciles), `cardIssuerVault` (the only full card numbers here, encrypted with an
equality index so a card is findable by its exact number over ciphertext), `issuedCardRegistry`,
`creditAssessmentState`, and the consent and third-party records its API is authorised by.

> Full schema definitions, field-level QE modes, index strategy, collection relationships and the ownership
> matrix covering every collection either service creates are in
> [docs/technical-spec.md](docs/technical-spec.md).

---

## 🛡️ PCI DSS Alignment

This demo demonstrates a **PCI DSS-aligned reference architecture**. MongoDB Atlas holds PCI DSS 4.0 certification. The customer remains responsible for their own PCI compliance program.

Key PCI DSS v4.0 requirements addressed:

- ✅ **Req 3**: Cardholder data encrypted before storage; SAD (CVV, PIN) never stored
- ✅ **Req 3.6**: Customer-controlled key management via AWS KMS
- ✅ **Req 4**: TLS 1.3 on all Atlas connections
- ✅ **Req 7**: Role-based field visibility (v2)
- ✅ **Req 10**: Audit log for all field access events (v2)

---

## 📁 Repository Structure

```
sec-fsi-pci-dss/
├── 💻 frontend/        # Next.js 14 App Router + TypeScript
├── ⚙️ backend/         # The payment service provider: Fastify 4 + TypeScript (setup + seed)
├── 🏦 bankcore/        # The bank (ASPSP): its own service, its own database, Open Banking API
├── 📦 packages/        # Shared workspaces (event bus, platform links)
└── 📚 docs/            # Engineering documentation
```

**Two institutions, two databases.** The provider does not hold customer funds: the bank owns the account
ledger, the account balances and the only full card numbers on the platform. They talk over HTTP, the
provider authenticating as a registered third party, and the bank notifying back with a signed event token.
Nothing is shared between the two databases except the encryption key vault.

---

## 🏗️ Technology Stack

| Layer | Technology |
|---|---|
| 💻 Frontend | Next.js 14 App Router + TypeScript |
| ⚙️ Backend API | Fastify 4 + TypeScript |
| 🗄️ Database | MongoDB Atlas (M10+) with Queryable Encryption |
| 🔑 Key Management | AWS KMS (local KMS fallback for offline demos) |
| 📦 Project setup | npm workspaces + concurrently |
| 🎨 UI Design | LeafyGreen Design System |

---

## 🗺️ Roadmap

| Version | Theme | Status | Key Features |
|---|---|---|---|
| 🟢 **v1** | Security Foundation | Complete | Payment simulation, JWT auth, dual-mode UI, QE encryption visible, fraud investigation |
| 🔵 **v2** | Investigation & Control | In Development | RBAC, escalation workflow, audit trail, HRPC check, profile management |
| 🟠 **v3** | Integration-ready API Surface | Planned | Recurring payments, webhook events, stable OpenAPI contracts, performance visualization, Leafy Bank scaffold |
| 🟣 **v4** | Payment Gateway + Integration Refinement | Planned | Modular backend (BIAN SD modules), gateway API, merchant as first-class actor, full payment order lifecycle |
| 🔴 **v5** | Agentic Integration | Planned | AI agent (Magenta / ThreatSight360) for automated fraud pre-review; draft diagnosis with Accept / Override |

See [Scope](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki/Scope) for a detailed breakdown of what each iteration implements, what is out of scope, and how this compares to a real payment gateway. For the complete FR, NFR, and acceptance criteria per iteration, see [docs/roadmap.md](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/blob/staging/docs/roadmap.md).

---

## 📚 Documentation

| Document | Description |
|---|---|
| 📖 [Project Wiki](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki) | Installation guide, Q&A, and additional resources for non-engineering readers |
| 📋 [PRD](docs/PRD.md) | What and why: audience, storyline, BIAN data model, QE design overview |
| 🗺️ [Roadmap](docs/roadmap.md) | FR and NFR per iteration (v1 / v2 / v3 / v4) with acceptance criteria and Definition of Done |
| 🛠️ [Technical Specification](docs/technical-spec.md) | BIAN TypeScript interfaces, QE `encryptedFieldsMaps`, API contracts, index strategy |
| 🏗️ [Engineering Proposal](docs/engineering-proposal.md) | Architecture decisions, implementation phases, risks, alternatives, ADRs |
| 🗂️ [Architecture Overview](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki/architecture) | Data model, PII fields, encryption design, collection relationships, and role model |
| ❓ [Q&A: PCI DSS](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki/q&a) | Common FSI client questions about MongoDB and PCI DSS compliance |
| 🐛 [Issues](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/issues) | Bug reports, feature requests, and task tracking |

### External References 
- [Redsys: Continue with the Integration](https://pagosonline.redsys.es/desarrolladores-inicio/continar-integracion/)
- [Redsys: Virtual POS Integration Models](https://pagosonline.redsys.es/desarrolladores-inicio/)
- [Redsys: Make a payment](https://pagosonline.redsys.es/desarrolladores-inicio/documentacion-operativa/autorizacion/#rest)
- [Redsys: Card validation (authentication)](https://pagosonline.redsys.es/desarrolladores-inicio/documentacion-operativa/operacion-autenticacion/)
- [Redsys: PSD2 and Strong Customer Authentication (SCA)](https://pagosonline.redsys.es/desarrolladores-inicio/documentacion-operativa/autenticacion-reforzada-sca-y-normativa-psd2/)

---

## ⚠️ Disclaimer

This demo uses **synthetic data only**. No real cardholder data, personal information, or production credentials are included. The demo is a reference architecture illustration and does not constitute a PCI DSS compliance certification or legal compliance advice.
