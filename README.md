# 🏦 FSI PCI DSS Payment Security Demo

> A MongoDB IST demo that shows how a digital bank or card issuer can run a complete card payment lifecycle: from checkout to fraud investigation: while keeping sensitive cardholder data encrypted end-to-end.

**Core message:** *🔐 Encrypt everything. 🔍 Query anything. 🔑 Keys are yours.*

---

## 🎯 What This Demo Shows

A synthetic digital bank uses **MongoDB Queryable Encryption (QE)** with **AWS KMS** to protect cardholder data. The server stores only ciphertext. Fraud analysts still search encrypted fields by email, phone, and account reference: without server-side decryption. Access is controlled by role. Every action is audited.

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

## 📚 Documentation

| Document | Description |
|---|---|
| [📖 Project Wiki](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki) | Installation guide, Q&A, and additional resources for non-engineering readers |
| [PRD](docs/PRD.md) | What and why: audience, storyline, BIAN data model, QE design overview |
| [Roadmap](docs/roadmap.md) | FR and NFR per iteration (v1 / v2 / v3 / v4) with acceptance criteria and Definition of Done |
| [Technical Specification](docs/technical-spec.md) | BIAN TypeScript interfaces, QE `encryptedFieldsMaps`, API contracts, index strategy |
| [Engineering Proposal](docs/engineering-proposal.md) | Architecture decisions, implementation phases, risks, alternatives, ADRs |
| [Q&A: PCI DSS](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki/q&a) | Common FSI client questions about MongoDB and PCI DSS compliance |
| [🐛 Issues](https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/issues) | Bug reports, feature requests, and task tracking |

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

---

## 🗄️ Data Architecture

The data model follows **BIAN Service Domain** naming conventions across 7 collections:

| Collection | BIAN Service Domain | QE Protection |
|---|---|---|
| `partyAuthenticationQE` | Party Authentication (SD-16) | equality: user email |
| `cardTransactionQE` | Card Transaction (SD-254) | equality: account reference; card token is plaintext (not CHD) |
| `cardTransactionSensitiveQE` | Card Transaction: Sensitive | none: gateway payload, processor metadata |
| `customerAgreementQE` | Customer Agreement (SD-53) | equality: email, phone, account reference |
| `customerAgreementSensitiveQE` | Customer Agreement: Sensitive | none: address, government ID, risk notes |
| `paymentCardQE` | Payment Card (SD-88) | none: expiry date; card token is plaintext (not CHD) |
| `fraudDiagnosisCase` | Fraud Diagnosis (SD-83) | plaintext: operational metadata only |

> Full schema definitions, field-level QE modes, index strategy, and collection relationships are in [docs/technical-spec.md](docs/technical-spec.md).

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
├── ⚙️ backend/         # Fastify 4 + TypeScript + NPM Tools (setup + seed)
└── 📚 docs/            # Engineering documentation
```

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

| Version | Theme | Key Features |
|---|---|---|
| 🟢 **v1** | Security Foundation | Payment simulation, JWT auth, dual-mode UI, QE encryption visible, fraud investigation |
| 🔵 **v2** | Investigation & Control | RBAC, escalation workflow, audit trail, KMS key rotation |
| 🟠 **v3** | Agentic | AI agent (Magenta) for automated fraud pre-review; draft diagnosis with Accept / Override |
| 🟣 **v4** | Advanced Capabilities | Save card / recurring payment, range queries, performance visualization, Leafy Bank scaffold |

See [docs/roadmap.md](docs/roadmap.md) for the complete FR, NFR, and acceptance criteria per iteration.

---

## ⚠️ Disclaimer

This demo uses **synthetic data only**. No real cardholder data, personal information, or production credentials are included. The demo is a reference architecture illustration and does not constitute a PCI DSS compliance certification or legal compliance advice.
