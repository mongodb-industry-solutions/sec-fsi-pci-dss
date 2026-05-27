# Demo Modes: UX Flow Design

**Project:** FSI PCI DSS Payment Security Demo
**Status:** Approved: design decisions resolved
**Last updated:** 2026-05-27
**PRD reference:** [PRD.md](PRD.md)
**Roadmap reference:** [roadmap.md](roadmap.md)
**Technical spec:** [technical-spec.md](technical-spec.md)

---

## 1. Two Access Modes

The demo exposes two entry points from the landing page. Each targets a different audience and context.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│       FSI PCI DSS Payment Security Demo                    │
│       MongoDB Queryable Encryption · AWS KMS               │
│                                                            │
│  ┌───────────────────────────┐  ┌─────────────────────b─┐  │
│  │   Simulator Mode          │  │   Application Mode    │  │
│  │                           │  │                       │  │
│  │  Story-driven. No login.  │  │  Real login. Roles.   │  │
│  │  Follow Luis's payment    │  │  JWT auth. Full RBAC  │  │
│  │  to fraud investigation.  │  │  escalation workflow. │  │
│  │                           │  │                       │  │
│  │  [Start Demo]             │  │  [→ Sign In]          │  │
│  └───────────────────────────┘  └───────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

| Dimension | Simulator Mode | Application Mode |
|---|---|---|
| Authentication | None: presenter-controlled | Local JWT: pre-defined users |
| Primary audience | Sales, CISO, executive briefing | Technical, SE, integration partner |
| Narrative control | Automatic flow with manual override | Role-based: login determines view |
| Field of view | All perspectives in one session | Each user sees only their role |
| Use case | 10-minute live demo | Hands-on evaluation, POC walkthrough |
| v1 scope | Full | Full |

---

## 2. Design Decisions: Resolved

### 2.1 Perspective switch after payment

**Decision:** Auto-switch to Investigation view after the confirmation screen, with a manual override button always visible.

The confirmation screen displays the fraud alert banner for 3 seconds, then automatically transitions to the Investigation view pre-loaded with the new case. A "Stay here" button interrupts the countdown. The `[→ Investigate this case]` link remains available in the banner for manual navigation.

This gives the presenter the smoothest narrative flow while retaining full control for audiences that need to linger on the confirmation screen.

### 2.2 Split-screen mode

**Decision:** Full-page view is the default. An optional split-screen toggle is offered for technical audiences.

**Full-page (default):** Each perspective occupies the entire viewport. Clean, focused, suitable for executive and sales demos. The presenter's narrative drives the story.

**Split-screen (optional toggle):** A `[Split View]` button in the simulator header activates a horizontal split:
- Left panel: customer or analyst interaction (live)
- Right panel: the corresponding raw Atlas document state, updated after each mutation

Split-screen is the most effective tool for a technically sophisticated audience because it makes the encryption contract visible in real time: the customer submits a payment on the left, and the ciphertext appears on the right without any manual toggle.

```
┌─────────────────────────┬──────────────────────────────────┐
│  Customer View          │  Atlas · cardTransactionQE       │
│                         │                                  │
│  Card: **** **** ****   │  {                               │
│        1234             │    "_id": "txn-001234",          │
│  Email: john@bank.com   │    "paymentCardReference":       │
│                         │      "\x06\x12\x89\xf4...",      │
│  [Confirm Payment]      │    "customerEmailAddress":       │
│                         │      "\x02\xa1\x7c\x33...",      │
│                         │    "transactionAmount": {        │
│                         │      "amount": 850.00,           │
│                         │      "currency": "USD"           │
│                         │    }                             │
│                         │  }                               │
└─────────────────────────┴──────────────────────────────────┘
```

### 2.3 Raw Atlas Document (the "Wow Moment")

**Decision:** The raw document toggle fetches the actual ciphertext from Atlas via a dedicated backend endpoint that bypasses QE auto-decryption.

The backend exposes `GET /api/v1/demo/raw-document/:collection/:id`. This endpoint connects using a plain MongoClient (no `autoEncryption` option) and returns the raw BSON document as stored in Atlas. The frontend renders it as a formatted JSON panel.

This means what the presenter shows is the actual Atlas storage state: not a simulation. If the audience has Compass or the Atlas Data Explorer open in parallel, they will see identical ciphertext blobs.

**Security note:** This endpoint is available only in demo environments (`NODE_ENV !== 'production'`). No decryption key material is exposed: the endpoint merely returns what Atlas stores.

---

## 3. Mode 1: Simulator

### 3.1 Route Structure

```
/                                   Landing (mode selector)
/simulator                          Simulator landing
/simulator/payment                  Step 1-3: checkout flow
/simulator/investigation            Analyst dashboard
/simulator/investigation/:caseId    Case detail (auto-loaded)
/simulator/audit                    Audit trail viewer (v2)
```

### 3.2 Header

```
┌──────────────────────────────────────────────────────────────────────┐
│  🏦 PCI DSS Demo · MongoDB          [💳 Payment] [🕵 Investigation] │
│                              [Split View]   Simulator Mode  [← Exit] │
└──────────────────────────────────────────────────────────────────────┘
```

- Perspective Switcher: two tabs, active one highlighted
- Split View toggle: activates the side-by-side Atlas panel
- v2: Role Selector inside Investigation view (Level 1 / Level 2 / Auditor)

### 3.3 Payment Flow

#### Step 1: Card Details

```
┌──────────────────────────────────────────────────────────────────┐
│  New Payment                                    Step 1 of 3      │
│                                                                  │
│  Card Number    [ **** **** **** 1234            ]               │
│                   Masked immediately: raw PAN never sent         │
│  Cardholder     [ Luis Fernandez                 ]               │
│  Expiry         [ 12 / 28  ]  Card token generated client-side   │
│                                                                  │
│  Email          [ luis.fernandez@leafybank.demo  ]               │
│  Phone          [ +44 7700 900123                ]               │
│  Amount         [ $ 850.00                       ]               │
│  Merchant       [ TechGadgets Ltd.               ]               │
│  MCC            [ 5734: Computer and Software    ]               │
│                                                                  │
│                                          [Next: Review →]        │
└──────────────────────────────────────────────────────────────────┘
```

Card number field: raw digits replaced with `****` on each keystroke. Last 4 digits remain visible. No raw PAN is ever held in component state after masking.

#### Step 2: Review (Encryption Explainer)

```
┌──────────────────────────────────────────────────────────────────┐
│  💳 Review Payment                                  Step 2 of 3  │
│                                                                  │
│  🔐 PII fields encrypted before leaving your browser             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Field                    Sent to Atlas                    │  │
│  │  ─────────────────────    ─────────────────────────────── │  │
│  │  🔒 Email (QE)        →  \x02\xa1\x7c\x33\xd8... (cipher) │  │
│  │  🔒 Phone (QE)        →  \x09\xfe\x45\x21\xb2... (cipher) │  │
│  │  🔒 Account ref (QE)  →  \x11\xbc\x78\xd2\xe4... (cipher) │  │
│  │  Card token           →  tok_7xB2kp1q         (plaintext)  │  │
│  │  Amount               →  850.00               (plaintext)  │  │
│  │  Merchant             →  TechGadgets Ltd.      (plaintext)  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  PII fields are encrypted at origin. No plaintext PAN, CVV, or  │
│  PIN is ever stored. The card token is a surrogate: not CHD.     │
│  Your KMS key controls decryption. MongoDB has zero access.      │
│                                                                  │
│  [← Back]                             [Confirm Payment →]        │
└──────────────────────────────────────────────────────────────────┘
```

#### Step 3: Confirmation + Fraud Alert

```
┌──────────────────────────────────────────────────────────────────┐
│  💳 Payment Confirmed                               Step 3 of 3  │
│                                                                  │
│  ✅ Transaction TXN-2026-001234 authorized                       │
│     Amount: $850.00 · Merchant: TechGadgets Ltd.                 │
│     Card: ****-****-****-1234 · 2026-05-27 14:32 UTC             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  🚨 Fraud Alert: Risk Severity: HIGH                     │    │
│  │  Amount above threshold + high-risk MCC (5734)           │    │
│  │  Case FD-2026-001234 has been opened automatically       │    │
│  │                                                          │    │
│  │  Switching to Investigation in 3s...  [Stay here]        │    │
│  │  [→ Investigate this case]                               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [← New Payment]                                                 │
└──────────────────────────────────────────────────────────────────┘
```

After confirmation: auto-switch to Investigation pre-loaded with case FD-2026-001234.

### 3.4 Investigation Flow

#### Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  🕵️ Fraud Investigation              [🕵 Level 1 Analyst ▼] v2  │
│                                                                  │
│  Search  [email ▼] [ luis.fernandez@leafybank.demo ] [🔍]        │
│          email / phone / account ref / card token                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Case            Transaction     Amount    Severity  Status│   │
│  │  ─────────────   ─────────────   ──────    ────────  ──── │   │
│  │  FD-2026-001234  TXN-001234      $850.00   HIGH      Open  │   │
│  │  FD-2026-001198  TXN-001198      $320.00   MEDIUM    Review│   │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Filter: [All Status ▼]  [All Severity ▼]                        │
└──────────────────────────────────────────────────────────────────┘
```

The email search matches `luis.fernandez@leafybank.demo` against the encrypted `customerEmailAddress` field in Atlas. The QE driver computes a deterministic search token from the plaintext query value and the DEK, then Atlas matches token-to-token. The server never holds or sees the plaintext value. Card token search (`cardToken=`) uses a standard MongoDB index: the payment token is a card surrogate, not CHD under PCI DSS v4.0, so QE is not required or appropriate for it.

#### Case Detail: Level 1 View

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Open          [⬆ Escalate] [✓ Clear]│
│                                                                  │
│  Transaction Details                                             │
│  Amount:    $850.00          Merchant: TechGadgets Ltd.          │
│  Card:      ****-****-****-1234       Channel: online            │
│  DateTime:  2026-05-27 14:32 UTC      MCC: 5734                  │
│                                                                  │
│  Customer Profile                                                │
│  Name:      Luis Fernandez   Segment: Retail · Active            │
│  🔒 Email:  [encrypted field: searchable, not displayed here]    │
│  🔒 Phone:  [encrypted field: searchable, not displayed here]    │
│  🔒 Account Ref: [encrypted]                                     │
│                                                                  │
│  Sensitive Fields                                                │
│  🔒 Address:    [Level 2 escalation required]                    │
│  🔒 Gov. ID:    [Level 2 escalation required]                    │
│                                                                  │
│  [🔐 View Raw Atlas Document]                                    │
└──────────────────────────────────────────────────────────────────┘
```

#### Raw Atlas Document Toggle

```
┌──────────────────────────────────────────────────────────────────┐
│  [Business View]  ●──●  [🔐 Raw Atlas Document]                 │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  BUSINESS VIEW                  ATLAS STORAGE (actual document)  │
│  ─────────────────              ───────────────────────────────  │
│  Email:  luis@leafybank.demo →  "customerEmailAddress":          │
│                                   "\x06\x12\x89\xf4\xa3\x2c..."  │
│                                   🔒 QE ciphertext               │
│                                                                  │
│  Phone:  +44 7700 900123     →  "customerMobilePhoneNumber":     │
│                                   "\x02\xa1\x7c\x33\xd8\x5e..."  │
│                                   🔒 QE ciphertext               │
│                                                                  │
│  Card:   tok_7xB2kp1q        →  "paymentCardReference":          │
│                                   "tok_7xB2kp1q"                 │
│                                   ✅ plaintext (token is not CHD)│
│                                                                  │
│  Amount: 850.00                 "transactionAmount.amount": 850  │
│  (v2: stored as QE range field)   ← plaintext in v1              │
│                                                                  │
│  "The analyst searched customerEmailAddress = luis@leafybank.demo│
│   while Atlas stored only ciphertext. The card token is stored   │
│   plaintext: it is a surrogate, not cardholder data under PCI    │
│   DSS v4.0. The server never decrypted the email or phone."      │
│                                                                  │
│  Source: cardTransactionQE · _id: txn-001234 · fetched live     │
└──────────────────────────────────────────────────────────────────┘
```

The raw document is fetched live from Atlas via `GET /api/v1/demo/raw-document/cardTransactionQE/txn-001234`. The backend endpoint uses a plain MongoClient (no autoEncryption) so the stored bytes are returned as-is.

**Presenter talking point:** "Notice the token is plaintext — that is intentional and correct. A payment token is a surrogate for the card number; it is not itself cardholder data under PCI DSS v4.0. The fields that ARE cardholder data — email, phone, account reference — those are the ciphertext blobs. We encrypt exactly what the standard requires, and nothing more."

#### Case Detail: Level 2 View (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Escalated      [✅ Resolve] [Close]│
│                                                                  │
│  [same transaction + Level 1 fields]                             │
│                                                                  │
│  Sensitive Fields (Level 2 · escalation approved)               │
│  ✅ Address:    14 Grove Lane, London, EC1A 1BB, UK             │
│  ✅ Gov. ID:    SYNTH-UK-48291047                               │
│  ✅ Risk Notes: Previous flag: rapid card reuse pattern          │
│                                                                  │
│  ⚠️  Access to sensitive fields has been logged                 │
│                                                                  │
│  [📋 View Audit Trail]                                          │
└──────────────────────────────────────────────────────────────────┘
```

#### Audit Trail (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│  📋 Audit Trail · Case FD-2026-001234                            │
│                                                                  │
│  Datetime (UTC)       Action           Role             Details  │
│  ─────────────────    ──────────────   ─────────────    ───────  │
│  2026-05-27 14:32     case_opened      payment_service   auto    │
│  2026-05-27 14:35     field_accessed   level1_analyst    email   │
│  2026-05-27 14:38     escalated        level1_analyst    :       │
│  2026-05-27 14:40     field_accessed   level2_invest     address │
│  2026-05-27 14:40     field_accessed   level2_invest     gov_id  │
│  2026-05-27 14:42     resolved         level2_invest     cleared │
│                                                                  │
│  [Sort: Newest ▼]  [Filter: All actions ▼]                       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.5 Presenter Script (10-minute path)

| Min | Action | Talking point |
|---|---|---|
| 0:00 | Open landing page | "This is a digital bank running entirely on MongoDB Atlas." |
| 0:30 | Click Simulator Mode | "Let's follow a customer checkout from start to investigation." |
| 1:00 | Fill card form | "Luis is paying for tech gear. He enters his card details." |
| 1:30 | Click Next: Review | "Watch what happens before this reaches MongoDB Atlas." |
| 2:00 | Point at encryption table | "These fields are encrypted in the browser. The server receives ciphertext." |
| 2:30 | Click Confirm | "Payment submitted. MongoDB flagged it as suspicious: amount over threshold, high-risk merchant category." |
| 3:00 | Auto-switch to Investigation | "We are now the fraud analyst. The case opened automatically." |
| 3:30 | Run email search | "I search by Luis's email. That field is encrypted in Atlas." |
| 4:00 | Results appear | "I found the record. The server matched ciphertext to ciphertext." |
| 4:30 | Click Raw Atlas Document | "This is what Atlas actually stores. Ciphertext." |
| 5:00 | Show split view | "On the left: what the analyst sees. On the right: what Atlas stores." |
| 5:30 | Point at KMS reference | "That key lives in AWS KMS. MongoDB has zero access to the key. Zero." |
| 6:00 | v2: Switch to Level 2 | "Now I'll escalate. Let me show you the access control layer." |
| 7:00 | v2: Show sensitive fields | "Level 2 approved. Address and government ID are now visible. And immediately logged." |
| 7:30 | v2: Open audit trail | "Every field access: who, what field, what time, which role. PCI DSS Requirement 10." |
| 8:00 | Recap | "Encrypted at origin. Queryable without server-side decryption. Keys are yours. Audited by default." |

---

## 4. Mode 2: Application Demo

### 4.1 Route Structure

```
/demo                               Login screen (mode selector)
/demo/payment                       Customer: checkout flow
/demo/payment/history               Customer: transaction history
/demo/investigation                 L1 Analyst: case dashboard
/demo/investigation/:caseId         L1 Analyst: case detail
/demo/investigation/escalated       L2 Investigator: escalation queue
/demo/audit                         Security Auditor: audit trail
```

All `/demo/*` routes require a valid JWT. Middleware reads role from token and gates route access. Unauthenticated requests redirect to `/demo`.

### 4.2 Login Screen

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   PCI DSS Demo · Sign In                                         │
│                                                                  │
│   Authentication domain:   [local ▼]                             │
│                                ├ local (demo users)              │
│                                └ (MS Entra ID: coming in v2)     │
│                                                                  │
│   Username  [ luis.fernandez@leafybank.demo   ▼ ]                │
│             ├ luis.fernandez@leafybank.demo  (Customer)          │
│             ├ julia.santos@leafybank.demo    (Customer)          │
│             ├ sarah.chen@leafybank.demo      (L1 Analyst)        │
│             ├ michael.obi@leafybank.demo     (L2 Investigator)   │
│             └ admin@leafybank.demo           (Security Auditor)  │
│                                                                  │
│   Password  [ ••••••••••••••• ]  (auto-filled on selection)      │
│                                                                  │
│   [Sign In]                                                      │
│                                                                  │
│   Test users and their passwords are pre-seeded.                 │
│       Select any user to auto-fill credentials.                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The username dropdown lists pre-defined users from the database. Selecting a user auto-fills the password field with the demo credential. The domain selector defaults to `local` (JWT against MongoDB). The MS Entra ID entry is wired but not active in v1.

### 4.3 Pre-defined Users and Roles

| User | Email | Role | Description |
|---|---|---|---|
| Luis Fernandez | luis.fernandez@leafybank.demo | customer | Retail: has card transactions and open cases |
| Julia Santos | julia.santos@leafybank.demo | customer | Premium: has saved card, recurrent payments (v3) |
| Sarah Chen | sarah.chen@leafybank.demo | level1_analyst | L1 Fraud Analyst: default investigation view |
| Michael Obi | michael.obi@leafybank.demo | level2_investigator | L2 Investigator: receives escalated cases |
| Admin | admin@leafybank.demo | security_auditor | Read-only: audit log and system status |

All users and their bcrypt-hashed passwords are inserted by the seeder (`bin/seed.ts`). Seeding is idempotent: upsert by `partyAuthenticationInstanceReference`.

### 4.4 Role: Customer (Luis / Julia)

#### Post-login: Transaction History

```
┌──────────────────────────────────────────────────────────────────┐
│  🏦 LeafyBank Demo        Luis Fernandez [Customer]  [Sign out]  │
│                                                                  │
│  💳 My Transactions                    [+ New Payment]           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Date           Merchant            Amount    Status      │    │
│  │  ─────────────  ─────────────────   ──────    ─────────  │    │
│  │  2026-05-27     TechGadgets Ltd.    $850.00   🚨 Flagged │    │
│  │  2026-05-15     Grocery Market      $45.00    ✅ Clear   │    │
│  │  2026-05-10     Petrol Station      $90.00    ✅ Clear   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ⚠️  One transaction is under fraud review.                     │
│     [View Status →]                                              │
└──────────────────────────────────────────────────────────────────┘
```

#### Fraud Alert Status View

```
┌──────────────────────────────────────────────────────────────────┐
│  🏦 LeafyBank Demo        Luis Fernandez [Customer]  [Sign out]  │
│                                                                  │
│  🚨 Transaction Under Review                                     │
│                                                                  │
│  Transaction:   TXN-2026-001234                                  │
│  Amount:        $850.00 · TechGadgets Ltd. · 2026-05-27          │
│  Status:        Under investigation                              │
│                                                                  │
│  Our fraud team is reviewing this transaction.                   │
│  You will be notified of the outcome.                            │
│                                                                  │
│  If you did not make this purchase, please contact support.      │
│                                                                  │
│  [← Back to Transactions]                                        │
└──────────────────────────────────────────────────────────────────┘
```

The customer sees the outcome state only: `under investigation`, `cleared`, or `confirmed fraud`. They do not see the investigation detail or analyst actions.

### 4.5 Role: Level 1 Analyst (Sarah)

#### Investigation Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  LeafyBank Demo    Sarah Chen [Level 1 Analyst]  [Sign out]      │
│                                                                  │
│  Case Dashboard                  [My Cases]  [All Open Cases]    │
│                                                                  │
│  Search  [email ▼] [                          ] [Search]         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Case ID       Transaction   Amount    Severity  Status  │    │
│  │  ──────────    ───────────   ──────    ────────  ─────── │    │
│  │  FD-2026-0234  TXN-001234    $850.00   HIGH      Open    │    │
│  │  FD-2026-0198  TXN-001198    $320.00   MEDIUM    Review  │    │
│  │  FD-2026-0187  TXN-001187    $1200.00  HIGH      Open    │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Filter: [All Status ▼]  [All Severity ▼]                        │
└──────────────────────────────────────────────────────────────────┘
```

#### Case Detail: L1

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Open        [✓ Clear] [⬆ Escalate] │
│  Assigned to: Sarah Chen · Opened: 2026-05-27 14:32              │
│                                                                  │
│  Transaction                                                     │
│  Amount:   $850.00    Merchant: TechGadgets Ltd.    MCC: 5734    │
│  Card:     ****-1234  Channel: online               TXN-001234   │
│                                                                  │
│  Customer                                                        │
│  Name:     Luis Fernandez   Segment: Retail · Active             │
│  🔒 Email:  [encrypted: equality-searchable]                     │
│  🔒 Phone:  [encrypted: equality-searchable]                     │
│  🔒 Acct:   [encrypted: equality-searchable]                     │
│                                                                  │
│  Sensitive Fields                                                │
│  🔒 Address:  [requires escalation to Level 2]                   │
│  🔒 Gov. ID:  [requires escalation to Level 2]                   │
│                                                                  │
│  Diagnosis Notes                                                 │
│  [ Add investigation note...                          ]          │
│  [Save Note]                                                     │
│                                                                  │
│  [🔐 View Raw Atlas Document]                                    │
└──────────────────────────────────────────────────────────────────┘
```

#### Escalation Dialog

```
┌──────────────────────────────────────────────────────────────────┐
│  ⬆️  Escalate Case FD-2026-001234                                │
│                                                                  │
│  Reason for escalation:                                          │
│  [ Amount over $800 threshold. Merchant category matches        ]│
│  [ recent fraud pattern. Customer has no prior flags.           ]│
│                                                                  │
│  This will:                                                      │
│  - Set case status to "escalated"                                │
│  - Notify the Level 2 Investigator queue                         │
│  - Log this action in the audit trail                            │
│                                                                  │
│  [Cancel]                          [Confirm Escalation]          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.6 Role: Level 2 Investigator (Michael)

#### Escalation Queue

```
┌──────────────────────────────────────────────────────────────────┐
│  🏦 LeafyBank Demo  Michael Obi [L2 Investigator]  [Sign out]   │
│                                                                  │
│  🔍 Escalated Cases                                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Case ID       Escalated By    Amount    Severity  Waiting│    │
│  │  ──────────    ────────────    ──────    ────────  ─────  │    │
│  │  FD-2026-0234  Sarah Chen      $850.00   HIGH      2 min  │    │
│  │  FD-2026-0145  Sarah Chen      $950.00   HIGH      1h     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [All Cases]                                                     │
└──────────────────────────────────────────────────────────────────┘
```

#### Case Detail: L2

```
┌──────────────────────────────────────────────────────────────────┐
│  Case FD-2026-001234 · HIGH · Escalated  [✅ Resolve] [✗ Reject]│
│  Escalated by: Sarah Chen · 2026-05-27 14:38                     │
│                                                                  │
│  [same transaction + customer fields as L1]                      │
│                                                                  │
│  Escalation Note                                                 │
│  "Amount over threshold. Merchant category matches recent        │
│   fraud pattern. Customer has no prior flags."                   │
│                                                                  │
│  Sensitive Fields (Level 2 · click to reveal)                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [🔓 Reveal Sensitive Fields]                            │   │
│  │  Note: Access will be logged in the audit trail          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [🔐 View Raw Atlas Document]  [📋 View Audit Trail]            │
└──────────────────────────────────────────────────────────────────┘
```

#### After Reveal

```
│  Sensitive Fields (Level 2 · accessed: 2026-05-27 14:40)        │
│  ✅ Address:    14 Grove Lane, London, EC1A 1BB, UK             │
│  ✅ Gov. ID:    SYNTH-UK-48291047                               │
│  ✅ Risk Notes: Previous flag: rapid card reuse                 │
│                                                                 │
│  ⚠️  Field access logged: address, gov_id, risk_notes           │
```

#### Resolution Dialog

```
┌──────────────────────────────────────────────────────────────────┐
│  Resolve Case FD-2026-001234                                     │
│                                                                  │
│  Outcome:                                                        │
│  ○ Confirmed fraud: card blocked                                 │
│  ● Transaction cleared: no fraud identified                      │
│  ○ Referred to external authority                                │
│                                                                  │
│  Resolution notes:                                               │
│  [ No prior fraud history. Customer verified by phone.         ] │
│  [ Transaction consistent with customer profile.               ] │
│                                                                  │
│  [Cancel]                             [Confirm Resolution]       │
└──────────────────────────────────────────────────────────────────┘
```

After resolution: case status changes to `resolved_cleared`. Customer (Luis) sees "Transaction cleared" in their history.

### 4.7 Role: Security Auditor (Admin)

```
┌───────────────────────────────────────────────────────────────────┐
│  LeafyBank Demo        Admin [Security Auditor]  [Sign out]       │
│                                                                   │
│  Audit Log                                                        │
│                                                                   │
│  Filter: [Case ID: FD-2026-001234  ] [All Actions ▼] [Search]     │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  Datetime (UTC)     Action         User           Field   │    │
│  │  ─────────────────  ────────────   ─────────────  ─────   │    │
│  │  2026-05-27 14:32   case_opened    payment_svc    auto    │    │
│  │  2026-05-27 14:35   field_accessed sarah.chen     email   │    │
│  │  2026-05-27 14:38   escalated      sarah.chen     :       │    │
│  │  2026-05-27 14:40   field_accessed michael.obi    address │    │
│  │  2026-05-27 14:40   field_accessed michael.obi    gov_id  │    │
│  │  2026-05-27 14:42   resolved       michael.obi    :       │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [Export CSV]  [Sort: Newest ▼]                                   │
└───────────────────────────────────────────────────────────────────┘
```

The auditor role is read-only. No case modification is possible from this view.

---

## 5. BIAN Fraud Diagnosis Case: Enriched Model

The `fraudDiagnosisCase` collection supports both modes. The application mode requires richer state.

### 5.1 Status State Machine

```
payment_service
     │ amount > threshold OR high-risk MCC
     ▼
  [ open ]
     │ L1 Analyst accepts
     ▼
[ under_review ]
     │                              │
     │ L1 clears                    │ L1 escalates
     ▼                              ▼
[ resolved_cleared ]          [ escalated ]
                                    │                    │
                                    │ L2 confirms fraud  │ L2 clears
                                    ▼                    ▼
                          [ resolved_fraud ]    [ resolved_cleared ]
                                    │                    │
                                    └──────┬─────────────┘
                                           ▼
                                        [ closed ]
```

### 5.2 TypeScript Interface

```typescript
interface FraudDiagnosisCase {
  // BIAN SD-83 identifiers
  fraudDiagnosisCaseInstanceReference: string;         // FD-YYYY-NNNNNN
  customerAgreementInstanceReference: string;          // link to customerAgreementQE
  cardTransactionInstanceReference: string;            // link to cardTransactionQE

  // Case lifecycle
  fraudDiagnosisCaseStatus:
    | 'open'
    | 'under_review'
    | 'escalated'
    | 'resolved_cleared'
    | 'resolved_fraud'
    | 'closed';
  fraudDiagnosisCaseSeverity: 'critical' | 'high' | 'medium' | 'low';
  fraudDiagnosisRequestDateTime: Date;
  fraudDiagnosisCaseClosingDateTime?: Date;

  // Assignment
  fraudDiagnosisAnalystInstanceReference?: string;    // L1 user reference
  fraudDiagnosisInvestigatorInstanceReference?: string; // L2 user reference

  // Assessment
  fraudDiagnosisAssessment: {
    riskIndicators: string[];                           // ["amount_threshold", "high_risk_mcc"]
    fraudDiagnosisScore?: number;                       // 0-100
    fraudDiagnosisConclusion?: string;
  };

  // Escalation (populated when status = escalated)
  fraudDiagnosisEscalationRecord?: {
    escalationDateTime: Date;
    escalationReason: string;
    escalatedByInstanceReference: string;
    escalatedToInstanceReference: string;
  };

  // Resolution (populated on close)
  fraudDiagnosisResolutionRecord?: {
    resolutionDateTime: Date;
    resolutionOutcome: 'cleared' | 'confirmed_fraud' | 'referred';
    resolutionNotes: string;
    resolvedByInstanceReference: string;
  };

  // Action log (append-only audit trail)
  diagnosisActionLog: Array<{
    actionDateTime: Date;
    actionType:
      | 'case_opened'
      | 'assigned'
      | 'note_added'
      | 'field_accessed'
      | 'escalated'
      | 'resolved'
      | 'closed';
    performedByInstanceReference: string;
    performedByRole: string;
    actionDetails: Record<string, unknown>;
  }>;
}
```

### 5.3 Why plaintext collection

`fraudDiagnosisCase` uses no QE fields. It contains operational metadata only: references, status, timestamps, and the audit log. The references it holds (e.g., `customerAgreementInstanceReference`) point to encrypted collections, but the case document itself carries no PII. This design keeps the fraud workflow performant and avoids QE complexity where it adds no security value.

---

## 6. Frontend Route Structure (Next.js App Router)

```
frontend/src/app/
├── page.tsx                         # Mode selector landing
├── layout.tsx                       # Root layout (LeafyGreen theme)
├── simulator/
│   ├── layout.tsx                   # Simulator header + perspective switcher
│   ├── page.tsx                     # Simulator landing (start options)
│   ├── payment/
│   │   └── page.tsx                 # 3-step checkout (steps in local state)
│   ├── investigation/
│   │   ├── page.tsx                 # Analyst dashboard + search
│   │   └── [caseId]/
│   │       └── page.tsx             # Case detail + raw Atlas toggle
│   └── audit/
│       └── page.tsx                 # Audit trail viewer (v2)
└── demo/
    ├── layout.tsx                   # Auth guard (redirect if no JWT)
    ├── page.tsx                     # Login screen with user selector
    ├── payment/
    │   ├── page.tsx                 # Customer: checkout
    │   └── history/
    │       └── page.tsx             # Customer: transaction history
    ├── investigation/
    │   ├── page.tsx                 # L1: case dashboard
    │   ├── [caseId]/
    │   │   └── page.tsx             # L1/L2: case detail
    │   └── escalated/
    │       └── page.tsx             # L2: escalation queue
    └── audit/
        └── page.tsx                 # Auditor: full audit log
```

Role-based routing is enforced in `demo/layout.tsx`. After JWT verification, the layout reads the `role` claim and redirects to the appropriate landing:
- `customer` redirects to `/demo/payment/history`
- `level1_analyst` redirects to `/demo/investigation`
- `level2_investigator` redirects to `/demo/investigation/escalated`
- `security_auditor` redirects to `/demo/audit`

---

## 7. Authentication Model

### 7.1 Token flow

```
POST /api/v1/auth/login
Body: { username, password, domain }
Response: { token: "<JWT>", user: { name, role, email } }
```

The JWT is a signed HS256 token (secret from `JWT_SECRET` env var). Payload:

```json
{
  "sub": "partyAuthenticationInstanceReference",
  "email": "sarah.chen@leafybank.demo",
  "role": "level1_analyst",
  "domain": "local",
  "iat": 1716816000,
  "exp": 1716902400
}
```

The `domain` field is the extension point. When domain is `msentra`, the backend delegates token validation to the MS Entra ID endpoint instead of verifying locally. In v1, only `local` is active.

### 7.2 Pre-populated user selector

`GET /api/v1/auth/users` returns the list of demo users (name, email, role) without passwords. The login screen calls this endpoint on mount to populate the dropdown. Selecting a user auto-fills the email and a known test password.

### 7.3 API security

All `/api/v1/*` endpoints except `/api/v1/auth/login`, `/api/v1/auth/users`, and `/api/v1/health` require a valid `Authorization: Bearer <JWT>` header. Missing or invalid tokens return HTTP 401. Role enforcement (e.g., L2 collections) returns HTTP 403.

In the Simulator mode, requests include a synthetic `X-Demo-Role` header instead of a JWT. The backend treats this header as trusted in demo/simulator mode. The role controls which collections are queried.

---

## 8. Shared Backend Vendors Structure

```
backend/
├── bin/
│   ├── setup.ts             # Calls src/vendors/setup/runSetup()
│   └── seed.ts              # Calls src/vendors/seed/runSeed()
└── src/
    ├── vendors/
    │   ├── encryption/
    │   │   ├── qeClient.ts          # MongoClient with autoEncryption
    │   │   ├── rawClient.ts         # Plain MongoClient (no autoEncryption)
    │   │   ├── kms.ts               # buildKmsProviders()
    │   │   ├── keyVault.ts          # DEK retrieval and creation
    │   │   └── encryptedFieldsMaps.ts
    │   ├── setup/
    │   │   ├── createCollections.ts # createEncryptedCollection() calls
    │   │   ├── createIndexes.ts     # index definitions
    │   │   └── provisionDEKs.ts     # DEK-lookup and DEK-sensitive setup
    │   └── seed/
    │       ├── seedUsers.ts         # partyAuthenticationQE seed
    │       ├── seedCustomers.ts     # customerAgreementQE seed
    │       ├── seedCards.ts         # paymentCardQE seed
    │       ├── seedTransactions.ts  # cardTransactionQE seed
    │       └── seedCases.ts         # fraudDiagnosisCase seed
    ├── controllers/
    ├── services/
    ├── models/
    └── middleware/
        ├── auth.ts                  # JWT verification
        └── rbac.ts                  # Role-based access enforcement
```

`backend/bin/` scripts are thin wrappers; the root `package.json` delegates to `backend/package.json`:

```json
// root package.json
{ "setup:db": "npm run setup:db --prefix backend", "seed": "npm run seed --prefix backend" }

// backend/package.json
{ "setup:db": "ts-node bin/setup.ts", "seed": "ts-node bin/seed.ts" }
```

---

## 9. Remaining Open Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Auto-switch after payment | Resolved: auto + manual fallback |
| 2 | Split-screen vs full-page | Resolved: full-page default + optional split toggle |
| 3 | Raw Atlas document | Resolved: real Atlas fetch via plain MongoClient |
| 4 | Fraud case auto-creation | Resolved: auto-triggered by amount > 500 or MCC in risk list |
| 5 | v2 role selector in simulator | Resolved: dropdown inside Investigation view header |
| 6 | MS Entra ID auth (v2) | Pending: extension hook designed, implementation deferred |
| 7 | v3 AI agent (Magenta) integration point | Pending: defined in roadmap.md v3 FR, design TBD |
