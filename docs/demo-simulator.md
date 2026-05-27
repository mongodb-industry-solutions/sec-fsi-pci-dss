# Demo Simulator — UX Flow Design

**Project:** FSI PCI DSS Payment Security Demo  
**Status:** Draft — pending design decisions  
**Last updated:** 2026-05-27  
**PRD reference:** [PRD.md](PRD.md)

---

## Context

The demo narrative has two distinct actor perspectives (customer and fraud analyst) that in production would be separate authenticated users in separate systems. For a demo environment there is no login — the presenter guides a single-session experience. This document defines how both perspectives coexist in one interface and how the presenter moves between them.

```
┌─────────────────────────────────────────────┐
│              Landing Page                   │
│  "Simulate how a digital bank protects      │
│   card data and investigates fraud"         │
│                                             │
│  [▶ Start Demo]                            │
└─────────────────────┬───────────────────────┘
                      │
         ┌────────────▼────────────┐
         │   💳 Customer View      │   ← Perspectiva 1
         │                         │
         │  Step 1: Card Details   │
         │  Step 2: Review         │   ← Lock icon aparece aquí
         │  Step 3: Confirm        │   ← "Fields encrypted before
         │                         │      leaving your browser"
         │  [Submit Payment]       │
         └────────────┬────────────┘
                      │
         ┌────────────▼────────────────────────────────┐
         │  Confirmation + Fraud Alert Banner          │
         │                                             │
         │  ✅ Transaction TXN-001234 authorized      │
         │  🚨 Fraud alert triggered — risk: HIGH     │
         │  [→ View in Investigation Dashboard]        │
         └────────────┬────────────────────────────────┘
                      │ (click, o auto-switch de perspectiva)
         ┌────────────▼──────────────┐
         │  🕵️ Investigation View   │   ← Perspectiva 2
         │                           │
         │  Search: [email ▼] [__]   │   ← QE equality search
         │                           │
         │  Results: TXN-001234      │
         │  🔒 customerEmailAddress │   ← Lock icon = campo cifrado
         │  🔒 paymentCardReference │
         │  Merchant: Online Store   │   ← Plaintext
         │  Amount: $850.00          │   ← Plaintext
         │                           │
         │  [🔍 View in Atlas]      │   ← Abre toggle "before/after"
         │  [⬆ Escalate]             │   ← v2: pasa a Level 2
         └───────────────────────────┘
```

---

## Core Design Principle

> **No login. One interface. Two perspectives.**

A **Perspective Switcher** in the header replaces authentication. Switching perspective is a deliberate, visible presenter action — like changing scenes in a live demonstration. Within the Investigation perspective, a **Role Selector** (v2) changes field visibility without any login flow.

---

## Interface Layout

### Header (persistent across all views)

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏦 PCI DSS Demo · MongoDB             [💳 Payment]  [🕵 Invest.] │
└─────────────────────────────────────────────────────────────────────┘
```

- Left: demo name and MongoDB branding
- Right: Perspective Switcher — two tabs, active one highlighted
- v2 addition: Role badge inside Investigation view (not in header)

### Role Selector (v2 — Investigation view only)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🏦 PCI DSS Demo · MongoDB             [💳 Payment]  [🕵 Invest.]      │
│  Investigation                                    [🕵 Level 1 ▼]        │
│                                                   ├ Level 1 Analyst      │
│                                                   ├ Level 2 Investigator │
│                                                   └ Security Auditor     │
└──────────────────────────────────────────────────────────────────────────┘
```

Selecting a role changes field visibility immediately. No page reload. Requests include `X-Demo-Role` header.

---

## Complete Demo Flow

### Landing Page

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   🏦  FSI PCI DSS Payment Security Demo                         │
│                                                                  │
│                                                                  │
│   How a digital bank protects card data and investigates fraud   │
│   using MongoDB Queryable Encryption and AWS KMS.                │
│                                                                  │
│   ┌──────────────────────┐  ┌───────────────────────┐            │
│   │  💳 Simulate Payment │  │  🕵 Investigate Case │            │
│   │  Start the flow from │  │  Jump directly to the │            │
│   │  the customer side   │  │  analyst dashboard    │            │
│   └──────────────────────┘  └───────────────────────┘            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Two entry points: full narrative flow (payment first) or direct jump to investigation (for repeat demos or technical audiences).

---

### Perspective 1 — 💳 Payment View

**Purpose:** Show that sensitive fields are encrypted before they leave the browser. The customer never sees this happen — it is shown as a visual explainer for the audience.

#### Step 1 — Card Details

```
┌──────────────────────────────────────────────────────────────────┐
│  💳 New Payment                                   Step 1 of 3   │
│                                                                  │
│  Card Number    [ **** **** **** 1234            ]               │
│                   Masked on entry — raw PAN never sent           │
│  Cardholder     [ John Doe                       ]               │
│  Expiry         [ 12 / 28  ]   Card token generated client-side  │
│                                                                  │
│  Billing Email  [ john@bank.com                  ]               │
│  Phone          [ +1 555 000 1234                ]               │
│  Amount         [ $ 850.00                       ]               │
│  Merchant       [ Online Store Inc.              ]               │
│                                                                  │
│                                          [Next: Review →]        │
└──────────────────────────────────────────────────────────────────┘
```

#### Step 2 — Review (Encryption Explainer)

```
┌─────────────────────────────────────────────────────────────────┐
│  💳 Review Payment                                 Step 2 of 3 │
│                                                                 │
│  🔐 Fields encrypted before leaving your browser               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Field               Value sent to MongoDB Atlas           │ │
│  │  ─────────────────   ───────────────────────────────────── │ │
│  │  Card token (QE)  →  \x06\x12\x89\xf4\xa3... (ciphertext)  │ │
│  │  Email (QE)       →  \x02\xa1\x7c\x33\xd8... (ciphertext)  │ │
│  │  Phone (QE)       →  \x09\xfe\x45\x21\xb2... (ciphertext)  │ │
│  │  Amount           →  850.00                (plaintext)     │ │
│  │  Merchant         →  Online Store Inc.     (plaintext)     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  The server stores ciphertext. No plaintext PAN, CVV, or PIN.   │
│                                                                 │
│  [← Back]                              [Confirm Payment →]      │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 3 — Confirmation + Fraud Alert

```
┌─────────────────────────────────────────────────────────────────┐
│  💳 Payment Confirmed                              Step 3 of 3 │
│                                                                 │
│  ✅ Transaction TXN-2026-001234 authorized                     │
│     Amount: $850.00 · Merchant: Online Store Inc.               │
│     Card: ****-****-****-1234 · 2026-05-27 14:32 UTC            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  🚨 Fraud Alert — Risk Severity: HIGH                   │   │
│  │  Unusual merchant category + amount above threshold      │   │
│  │  Case FD-2026-001234 has been created automatically      │   │
│  │                                                          │   │
│  │  [→ Investigate this case]                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [← New Payment]                                                │
└─────────────────────────────────────────────────────────────────┘
```

The **"Investigate this case"** button switches perspective to Investigation and pre-loads the case. This is the narrative link between both views.

---

### Perspective 2 — 🕵️ Investigation View

**Purpose:** Show that a fraud analyst can search encrypted fields and find records — without the server ever decrypting them. The encryption story is visible, not abstract.

#### Investigation Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  🕵️ Fraud Investigation                       [🕵 Level 1 ▼]    │
│                                                                  │
│  Search  [email ▼] [ john@bank.com        ] [🔍 Search]         │
│          email / phone / account ref / card token                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Case            Transaction     Amount    Risk    Status │   │
│  │  ─────────────   ─────────────   ──────    ────    ────── │   │
│  │  FD-2026-001234  TXN-001234      $850.00   HIGH    Open   │   │
│  │  FD-2026-001198  TXN-001198      $320.00   MED     Review │   │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Filter: [All Status ▼]  [All Severity ▼]                        │
└──────────────────────────────────────────────────────────────────┘
```

Note: The search matched `john@bank.com` against the encrypted `customerEmailAddress` field in Atlas. The server returned the result without decrypting the field.

#### Case Detail — Level 1 View

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Open              [⬆ Escalate]     │
│                                                                  │
│  Transaction Details                                             │
│  Amount:    $850.00          Merchant: Online Store Inc.         │
│  Card:      ****-****-****-1234       Channel: online            │
│  DateTime:  2026-05-27 14:32 UTC      MCC: 5999                  │
│                                                                  │
│  Customer                                                        │
│  Name:      John Doe         Segment: Retail · Status: Active    │
│  🔒 Email:  [encrypted — searched, not displayed]               │
│  🔒 Phone:  [encrypted — searched, not displayed]               │
│  🔒 Account Ref: [encrypted]                                    │
│                                                                  │
│  Sensitive Fields (Level 1 access)                               │
│  🔒 Address:    [requires Level 2 escalation]                    │
│  🔒 Gov. ID:    [requires Level 2 escalation]                    │
│  [🔐 View Raw Atlas Document]                                    │
└──────────────────────────────────────────────────────────────────┘
```

#### "Encrypted in Atlas" Toggle — The Wow Moment

```
┌──────────────────────────────────────────────────────────────────┐
│  [Business View]  ●  [🔐 Raw Atlas Document]                    │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  BUSINESS VIEW               RAW ATLAS DOCUMENT                  │
│  ─────────────────           ──────────────────────────────────  │
│  Email:  john@bank.com  →    "customerEmailAddress":             │
│                              "\x06\x12\x89\xf4\xa3\x2c..."       │
│                                                                  │
│  Phone:  +1 555 000 1234 →   "customerMobilePhoneNumber":        │
│                              "\x02\xa1\x7c\x33\xd8\x5e..."       │
│                                                                  │
│  Card token:  tok_abc1 →     "paymentCardReference":             │
│                              "\x09\xfe\x45\x21\xb2\x77..."       │
│                                                                  │
│  Amount:  850.00             "transactionAmount.amount":         │
│  (added in v2 as QE range)   850.00   ← plaintext in v1          │
│                                                                  │
│  "The analyst searched customerEmailAddress = john@bank.com      │
│   while Atlas stored only the ciphertext above.                  │
│   The server never decrypted this field."                        │
└──────────────────────────────────────────────────────────────────┘
```

#### Case Detail — Level 2 View (v2)

Switching role to Level 2 Investigator after escalation approval reveals sensitive fields:

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Escalated          [✅ Resolve]   │
│                                                                  │
│  [same transaction + customer fields as Level 1]                 │
│                                                                  │
│  Sensitive Fields (Level 2 — escalation approved)                │
│  ✅ Address:    123 Main St, New York, NY 10001, US             │
│  ✅ Gov. ID:    SYNTH-48291047                                  │
│  ✅ Risk Notes: Previous flag: rapid card reuse pattern         │
│                                                                  │
│  ⚠️ Access to sensitive fields has been logged                  │
│                                                                  │
│  [📋 View Audit Trail]                                          │
└──────────────────────────────────────────────────────────────────┘
```

#### Audit Trail (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│  📋 Audit Trail · Case FD-2026-001234                            │
│                                                                  │
│  DateTime (UTC)       Action           Role            Details   │
│  ─────────────────    ──────────────   ─────────────   ────────  │
│  2026-05-27 14:32     case_opened      payment_service  Auto     │
│  2026-05-27 14:35     field_accessed   level1_analyst   email    │
│  2026-05-27 14:38     escalated        level1_analyst   —        │
│  2026-05-27 14:40     field_accessed   level2_invest.   address  │
│  2026-05-27 14:40     field_accessed   level2_invest.   gov_id   │
│                                                                  │
│  [Sort ▼]  [Filter by action ▼]                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Presenter Script (10-minute path)

| Min | Action | What to say |
|---|---|---|
| 0:00 | Open landing page | "This is a digital bank running on MongoDB Atlas." |
| 0:30 | Click 💳 Payment | "Let's simulate a customer checkout." |
| 1:00 | Fill card form | "The customer enters their card details." |
| 1:30 | Click Next → Review | "Watch what happens before this data reaches MongoDB." |
| 2:00 | Point at encryption table | "These fields are encrypted in the browser. The server never sees the plaintext." |
| 2:30 | Confirm payment | "Payment submitted. And MongoDB just flagged it as suspicious." |
| 3:00 | Click "Investigate this case" | "Now we switch to the fraud analyst's view." |
| 3:30 | Run email search | "I search by the customer's email — an encrypted field in Atlas." |
| 4:00 | Results appear | "I found the record. The server matched ciphertext to ciphertext." |
| 4:30 | Click "View Raw Atlas Document" | "This is what Atlas actually stores." |
| 5:00 | Show ciphertext side-by-side | "Server-side: ciphertext. My browser decrypts it locally, with the key I control." |
| 5:30 | Point at AWS KMS | "That key lives in AWS KMS. MongoDB has zero access to it." |
| 6:00 | *(v2)* Switch to Level 2 | "Now let me show you what happens when a Level 1 analyst escalates." |
| 7:00 | *(v2)* Show sensitive fields revealed | "Level 2 approved. Now I can see the address and government ID." |
| 7:30 | *(v2)* Open audit trail | "Every access is logged. Who accessed what field, at what time, under which role." |
| 8:00 | Recap | "Encrypted at origin. Queryable without decryption. Keys are yours." |

---

## Frontend Route Structure

```
/                           ← Landing page
/demo/payment               ← Perspective 1: checkout flow
/demo/investigation         ← Perspective 2: analyst dashboard
/demo/investigation/:caseId ← Case detail (pre-loaded from payment flow)
```

Navigation between perspectives uses the header switcher (client-side routing — no page reload).

---

## Open Design Decisions

| # | Decision | Options | Impact |
|---|---|---|---|
| 1 | **Perspective switch after payment** | A) Auto-switch to Investigation B) Manual click on "Investigate this case" | A is more fluid for live demos; B gives the presenter more control |
| 2 | **Split-screen vs full-page perspectives** | A) Each perspective is full-screen B) Optional side-by-side split-screen mode | B is powerful for technical audiences; A is cleaner for exec demos |
| 3 | **Raw Atlas document** | A) Real ciphertext fetched from Atlas API B) Visual simulation of ciphertext format | A is more authentic; B works offline and is faster to implement |
| 4 | **QE explainer in payment step** | A) Table showing field → ciphertext (as shown above) B) Simple banner "Fields encrypted" C) Animated visualization | B for v1 simplicity; A or C for v2 polish |
| 5 | **Fraud case creation** | A) Auto-triggered by amount threshold or MCC B) Manual trigger button "Flag this transaction" | A is more realistic; B gives the presenter full control over demo timing |
| 6 | **Returning to payment view** | A) "New payment" button resets the form B) Keep the last payment visible and add a history list | A is simpler for v1 |

---

## Notes from domain expert feedback

> *"Será simular un pago con tarjeta de crédito (que luego lo podemos incorporar en el Leafy Bank), y encriptar datos sensibles. Los temas más complejos son cuando el usuario decide guardar de la tarjeta (en el cache del browser, registrarla como medio de pago recurrente/preferido, etc.)"*

- The **save card flow** (v3) is precisely the scenario where the encryption story is most compelling: the presenter can show that saving a card stores only the token in Atlas (encrypted) — never the raw PAN — and the browser retains nothing sensitive.
- The link to **Leafy Bank** means the component interfaces (especially the payment form and API contracts) should be designed for composability from day one.
