# Demo Modes: UX Flow Design

**Project:** FSI PCI DSS Payment Security Demo
**Status:** Approved: design decisions resolved
**Last updated:** 2026-06-10
**PRD reference:** [PRD.md](PRD.md)
**Roadmap reference:** [roadmap.md](roadmap.md)
**Technical spec:** [technical-spec.md](technical-spec.md)

---

## 1. Two Access Modes

The demo exposes two entry points from the landing page. Each targets a different audience and context.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│       FSI PCI DSS Payment Gateway Demo                     │
│       MongoDB Queryable Encryption · AWS KMS               │
│                                                            │
│  ┌───────────────────────────┐  ┌───────────────────────┐  │
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
│  Customer View          │  Atlas · cardTransaction       │
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
│  Email          [ luis.fernandez@back.es  ]               │
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
│  Search  [email ▼] [ luis.fernandez@back.es ] [🔍]        │
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

The email search matches `luis.fernandez@back.es` against the encrypted `customerEmailAddress` field in Atlas. The QE driver computes a deterministic search token from the plaintext query value and the DEK, then Atlas matches token-to-token. The server never holds or sees the plaintext value. Card token search (`cardToken=`) uses a standard MongoDB index: the payment token is a card surrogate, not CHD under PCI DSS v4.0, so QE is not required or appropriate for it.

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
│  Email:  luis@back.es →  "customerEmailAddress":          │
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
│  "The analyst searched customerEmailAddress = luis@back.es│
│   while Atlas stored only ciphertext. The card token is stored   │
│   plaintext: it is a surrogate, not cardholder data under PCI    │
│   DSS v4.0. The server never decrypted the email or phone."      │
│                                                                  │
│  Source: cardTransaction · _id: txn-001234 · fetched live     │
└──────────────────────────────────────────────────────────────────┘
```

The raw document is fetched live from Atlas via `GET /api/v1/demo/raw-document/cardTransaction/txn-001234`. The backend endpoint uses a plain MongoClient (no autoEncryption) so the stored bytes are returned as-is.

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
│   Username  [ luis.fernandez@back.es   ▼ ]                │
│             ├ luis.fernandez@back.es  (Customer)          │
│             ├ julia.santos@back.es    (Customer)          │
│             ├ sarah.chen@back.es      (L1 Analyst)        │
│             ├ michael.obi@back.es     (L2 Investigator)   │
│             └ admin@back.es           (Security Auditor)  │
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
| Luis Fernandez | luis.fernandez@back.es | customer | Retail: has card transactions and open cases |
| Julia Santos | julia.santos@back.es | customer | Premium: has saved card, recurrent payments (v3) |
| Sarah Chen | sarah.chen@back.es | level1_analyst | L1 Fraud Analyst: default investigation view |
| Michael Obi | michael.obi@back.es | level2_investigator | L2 Investigator: receives escalated cases |
| Admin | admin@back.es | security_auditor | Read-only: audit log and system status |

All users and their bcrypt-hashed passwords are inserted by the seeder (`bin/seed.ts`). Seeding is idempotent: upsert by `partyAuthenticationInstanceReference`.

### 4.4 Role: Customer (Luis / Julia)

#### Post-login: Transaction History

```
┌──────────────────────────────────────────────────────────────────┐
│  🏦 Payment Gateway      Luis Fernandez [Customer]  [Sign out]  │
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
│  🏦 Payment Gateway       Luis Fernandez [Customer]  [Sign out]  │
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
│  Messages from security team                                     │
│  ─────────────────────────────────────────────────────────────   │
│  2026-05-27 14:45 UTC                                            │
│  We have received your case and are reviewing the transaction.   │
│  A decision will be made within 24 hours.                        │
│                                                                  │
│  If you did not make this purchase, please contact support.      │
│                                                                  │
│  [← Back to Transactions]                                        │
└──────────────────────────────────────────────────────────────────┘
```

The customer sees the outcome state only: `under investigation`, `cleared`, or `confirmed fraud`. They do not see the investigation detail or analyst actions. The "Messages from security team" section shows only notes with `visibility:'customer'` that have not been retracted, listed in chronological order. There is no add or retract capability on the customer side.

### 4.5 Role: Level 1 Analyst (Sarah)

#### Investigation Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  Payment Gateway   Sarah Chen [Level 1 Analyst]  [Sign out]      │
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
│  🏦 Payment Gateway Michael Obi [L2 Investigator]  [Sign out]   │
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

#### Escalation Approval Persistence

Once L2 approves an escalation (clicks "Approve Escalation"), the `escalationAcceptedAt` timestamp is written to the case document. On subsequent loads of the case detail page, the "Approve Escalation" button is replaced by two elements:

- The escalation token info (approver, accepted timestamp)
- A "Reject Escalation" button

This state persists across page refresh because it is derived from `escalationAcceptedAt` on the stored case document, not from local UI state.

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

### 4.7 Role: Security Auditor (Diego Sans)

```
┌───────────────────────────────────────────────────────────────────┐
│  Payment Gateway       Admin [Security Auditor]  [Sign out]       │
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

### 4.8 Case Notes Panel

The Case Notes Panel appears on the case detail page (`/demo/investigation/[caseId]`) for all analyst roles. It is a separate panel below the transaction and customer fields.

#### Layout

The panel is divided into two visually distinct sections:

```
┌──────────────────────────────────────────────────────────────────┐
│  Case Notes                                      [+ Add Note]    │
│                                                                  │
│  Internal Notes                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  (gray background — L1 / L2 / Auditor only)                │  │
│  │                                                            │  │
│  │  2026-05-27 14:35 UTC · Level 1 Analyst                    │  │
│  │  Checked customer transaction history. No prior flags.     │  │
│  │                                              [trash icon]  │  │
│  │                                                            │  │
│  │  2026-05-27 14:37 UTC · Level 1 Analyst      [Retracted]   │  │
│  │  ~~Initial note before full review. Disregard.~~           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Customer-Visible Notes                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  (green background — also shown to customer)               │  │
│  │                                                            │  │
│  │  2026-05-27 14:45 UTC · Level 1 Analyst                    │  │
│  │  We have received your case and are reviewing it.          │  │
│  │  A decision will be made within 24 hours.                  │  │
│  │                                              [trash icon]  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

- **Internal notes** (gray background): visible only to L1 analysts, L2 investigators, and security auditors.
- **Customer-visible notes** (green background): visible to analysts in the panel and also shown to the customer on `/demo/payment/history/[txnId]` as "Messages from security team".
- **Retracted notes** appear with strikethrough text and a "Retracted" badge. They remain visible to analysts for audit trail purposes but are excluded from the customer view.
- Each note displays: note text, role of the author, and timestamp.

#### Role-Based Capabilities

| Role | Read internal notes | Read customer-visible notes | Add note | Retract note |
|---|---|---|---|---|
| Level 1 Analyst | Yes | Yes | Yes | Own notes only |
| Level 2 Investigator | Yes | Yes | Yes | Own notes only |
| Security Auditor | Yes | Yes | No | No |
| Customer | No | Yes (non-retracted only) | No | No |

The "[+ Add Note]" button in the top-right of the panel is only rendered for L1 and L2 roles. The trash icon on a note is only rendered if the current user's role matches the role that wrote the note.

#### Add Note Flow (L1 and L2 only)

1. Click the "[+ Add Note]" button in the top-right of the panel.
2. A note composition form opens with two tabs: **Internal** and **Customer-visible**.
3. Select the desired tab and write the note text.
4. If **Customer-visible** is selected, clicking "Save Note" first shows a confirmation modal:

```
┌──────────────────────────────────────────────────────────────────┐
│  Confirm: Customer-Visible Note                                  │
│                                                                  │
│  This note will be immediately visible to the customer.          │
│  It cannot be edited after saving — only retracted.              │
│                                                                  │
│  [Cancel]                                    [Confirm & Save]    │
└──────────────────────────────────────────────────────────────────┘
```

5. On confirm, the note is saved as a `note_added` event in `diagnosisActionLog`. The panel reloads to show the new note.
6. If **Internal** is selected, no confirmation modal is shown — the note is saved directly.

#### Retract Note Flow (L1 and L2 only — own notes)

1. The trash icon is visible on notes whose `performedByRole` matches the current user's role.
2. Clicking the trash icon opens the retraction modal:

```
┌──────────────────────────────────────────────────────────────────┐
│  Retract Note                                                    │
│                                                                  │
│  Original note:                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ~~Initial note before full review. Disregard.~~           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Reason (optional):                                              │
│  [ Written in error before full case review.         ]           │
│                                                                  │
│  [Cancel]                                    [Confirm Retraction]│
└──────────────────────────────────────────────────────────────────┘
```

3. On confirm, a `note_retracted` event is appended to `diagnosisActionLog` (no physical delete). The note is marked retracted in the panel with strikethrough and a "Retracted" badge. If the note had `visibility:'customer'`, it is no longer shown on the customer side.

#### Storage Model

Notes are stored inside `diagnosisActionLog` entries with `actionType: 'note_added'`. The `actionDetails` object for a note entry carries:

```typescript
{
  noteText: string;           // original note content
  visibility: 'internal' | 'customer';
  retracted?: boolean;        // true after a note_retracted event references this entry
}
```

A retraction appends a separate `note_retracted` entry that references the original note's log index or a note ID. No document mutation occurs on the original entry: retraction is recorded as an append, preserving the full audit trail.

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
  customerAgreementInstanceReference: string;          // link to customerAgreement
  cardTransactionInstanceReference: string;            // link to cardTransaction

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
      | 'note_retracted'
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
  "email": "sarah.chen@back.es",
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
    │       ├── seedUsers.ts         # partyAuthentication seed
    │       ├── seedCustomers.ts     # customerAgreement seed
    │       ├── seedCards.ts         # paymentCard seed
    │       ├── seedTransactions.ts  # cardTransaction seed
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
{ "setup:db": "npm run setup:db --prefix backend", "setup:seed": "npm run seed --prefix backend" }

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

---

## 10. Ch-04 Payment Integration Routes

Three new routes added in Ch-04. Two are **public** (no auth, no sidebar); one is inside the demo layout.

### 10.1 Route Map

| Route | Layout | Auth | Purpose |
|---|---|---|---|
| `/checkout/[sessionId]` | Standalone (no sidebar) | None | Hosted Payment Page for Redirect Checkout |
| `/pay/[linkCode]` | Standalone (no sidebar) | None | Payment Link Landing Page |
| `/demo/merchant` | Demo layout (sidebar) | JWT (any role) | Merchant Sandbox — integration demo tool |

### 10.2 Hosted Payment Page — `/checkout/[sessionId]`

Public page. Buyer is redirected here by the merchant after calling `POST /api/v1/checkout/sessions`.

**State machine:**

| State | Trigger | UI |
|---|---|---|
| `loading` | On mount | Spinner |
| `ready` | Session loaded, status `pending` | Card form |
| `paying` | Form submit | Submit button disabled, "Processing..." |
| `success` | `POST /pay` returns 200 | Success screen with countdown redirect |
| `expired` | Session `status = expired/cancelled` | Error screen with cancel URL link |
| `completed` | Session `status = completed` | "Already paid" screen |
| `error` | 404 or network failure | Error screen |

**Card form fields:**
- Cardholder name (required)
- Card number (16 digits, last 4 used to generate display mask)
- Expiry month / year (MM / YY)
- CVV (UI only — not sent to backend)

**Tokenization (demo):** Frontend generates `tok_<12 random hex><last4>` as the card token. Raw PAN is never sent to the backend. This is the PCI DSS SAQ A pattern.

**On success:** `router.push(redirectUrl)` after 2 seconds — `redirectUrl` is `returnUrl?status=success&session={id}` from the pay response.

**On cancel:** `<a href={cancelUrl}>Cancel and return to merchant</a>` link at the bottom.

### 10.3 Payment Link Landing Page — `/pay/[linkCode]`

Public page. Buyer opens link shared by merchant via email, QR code, or social media.

**State machine:**

| State | Trigger | UI |
|---|---|---|
| `loading` | On mount | Spinner |
| `ready` | Link loaded, status `active` | Card form + optional customer message |
| `paying` | Form submit | Submit button disabled |
| `success` | `POST /pay` returns 200 | Inline success screen with transaction ref |
| `unavailable` | Link status `completed/expired/deactivated` | Status-specific message |
| `error` | 404 or network failure | Not found screen |

**Differences from checkout page:**
- No timer or "session expires in X min" notice (links are long-lived)
- No cancel link (buyer just closes the tab)
- Shows `paymentLinkCustomerMessage` if present (merchant-provided context)
- Optional email field for linking payment to customer record
- Success is inline (no redirect) — buyer sees confirmation on the same page

**Status messages:**
- `completed` (single_use): "This payment link has already been used."
- `expired`: "This payment link has expired."
- `deactivated`: "This payment link is no longer active."

### 10.4 Merchant Sandbox — `/demo/merchant`

Inside the demo layout. Accessible to all authenticated roles via the "Merchant" nav item in the sidebar.

**Purpose:** Allows demo viewers to act as a merchant and test both payment integration patterns without leaving the browser.

**Tab layout:**

| Tab | Label | Content |
|---|---|---|
| `checkout` | Checkout Session | Create session form + paymentPageUrl display with copy/open |
| `links` | Payment Links | Create link form + active links list with deactivate action |
| `keys` | API Keys | Generate key (shown once) |
| `webhook` | Webhook | Configure HTTPS endpoint for payment event callbacks |

**Merchant selector:** Dropdown at the top populated from `GET /api/v1/merchants`. Changing selection resets all result state.

**Checkout Session tab:**
- Form: amount, currency, description, merchantReference, returnUrl, cancelUrl
- On submit: `POST /api/v1/checkout/sessions` with JWT
- Result: green panel with `paymentPageUrl` + copy button + external link button

**Payment Links tab:**
- Create form: amount, currency, description, customerMessage (optional), usageType (single_use/multi_use)
- On submit: `POST /api/v1/payment-links` with JWT
- Result: green panel with `paymentUrl` + code + copy/open buttons
- Active links list: fetched from `GET /api/v1/payment-links?merchantId=...`
  - Shows: code, status badge, usage type, amount, use count
  - Deactivate button (calls `PATCH /api/v1/payment-links/:id`)
  - External link button (opens `/pay/{code}` in new tab)

**API Keys tab:**
- "Generate New API Key" button
- On generate: shows full `lbpk_live_<32hex>` key in green panel with copy button
- Warning: "Shown once. Save it now."
- Shows keyId and keyPrefix for reference

**Webhook tab:**
- HTTPS URL input
- "Save Webhook URL" button (calls `POST /api/v1/merchants/:id/webhooks`)
- Event documentation: `checkout.completed`, `payment_link.completed`
- Signature info: `X-Webhook-Signature: sha256=<hmac>`

### 10.5 Sidebar Navigation

`Store` icon added to `DemoSidebar` for all roles pointing to `/system/merchant`.

```typescript
{ label: 'Merchant', path: '/system/merchant', icon: Store }
```

Added to: `level1_analyst`, `level2_investigator`, `security_auditor`, `customer`, `merchant_officer`.

---

## 11. Debug Mode (Ch-05)

Debug Mode converts Application Mode from a clean business narrative into a technical deep-dive view. It is the primary mechanism for explaining MongoDB Queryable Encryption, BIAN alignment, and PCI DSS compliance to FSI architects without leaving the application.

### 11.1 Toggle

- **Location:** Top navigation bar (right side, next to user avatar).
- **Label:** `⚡ Debug` (off) / `⚡ Debug ON` (on, with accent color).
- **Guard:** Only rendered when `NEXT_PUBLIC_DEMO_DEBUG_ENABLED=true` is set at build time. Hidden otherwise.
- **Persistence:** State stored in `localStorage` key `demo_debug_mode`. Survives navigation and page refresh.
- **No reload required:** Toggle is instant (React context update propagates synchronously).

### 11.2 Business Mode (Debug OFF)

Default state. The UI is identical to what a non-technical bank employee would see:
- Professional card-based layout with BIAN field names in plain English.
- No technical badges, no BSON notation, no QE labels.
- Login screen: standard username + password form.
- Forms: empty fields, manual entry.

### 11.3 Technical Mode (Debug ON)

Every UI element gains a technical context layer.

#### BIAN Badges

Every entity card shows:
- BIAN Service Domain chip: e.g. `SD-89 · Merchant Relations`
- Collection name chip: e.g. `merchantAgreementProcedure`
- PCI DSS scope classification: `CDE-adjacent` / `in-scope` / `non-CDE`

#### Field Labels

Each form/display field shows a debug tag:
- `[unencrypted · SD-89 BQ: MerchantName]` for plaintext fields
- `[QE:none 🔒 · PCI DSS Req 3.5.1]` for encrypted-at-rest fields
- `[QE:equality 🔒 · PCI DSS Req 3.5.1]` for searchably-encrypted fields

Hovering the lock icon shows: `"Stored as BSON Binary subtype 6 — MongoDB Atlas server never decrypts this field"`

#### Action Button Info Panel

Every action button has an `[ℹ]` icon. Clicking it expands an info panel:

```
BIAN Action Term:   Initiate
HTTP Endpoint:      POST /api/v1/merchants
MongoDB Operation:  insertOne → merchantAgreementProcedure
PCI DSS Control:    Req 12.8 — Document merchant agreement
Business Logic:     Creates agreement at under_review status.
                    A merchant_officer must approve before activation.
```

#### Raw Document Panel (`DebugRawDoc`)

Available on: Merchant detail, Transaction detail, Fraud Case detail.

The panel shows the live MongoDB document with encrypted fields displayed as `Binary('hex...', 6)` — the actual BSON ciphertext on disk:

```json
{
  "_id": { "$oid": "..." },
  "bianServiceDomain": "Merchant Relations",
  "merchantName": "Espresso Works Ltd",
  "merchantApiKeyHash": "Binary('a1b2c3...', 6)",
  "merchantCategoryCode": "5812",
  "merchantAgreementStatus": "active"
}
```

- Fetched live from `GET /api/v1/system/raw/merchantAgreementProcedure/:id`.
- `[⟳]` button re-fetches in real time (demonstrates the document is live, not a screenshot).
- `[Copy]` button copies the full JSON to clipboard.

### 11.4 Debug Mode by Page

| Page | Debug Additions |
|---|---|
| `/system` (home) | BIAN architecture map panel showing all SD modules in scope |
| `/system/merchant` | SD-89 badge, field QE labels, Raw Document panel, action info panels |
| `/system/merchant/review` | SD-89 badge per application, `Control` action term badge on Approve/Reject buttons |
| `/system/investigation` | SD-83 badge, field QE labels, Raw Document panel on transaction detail |
| `/gateway/checkout/:id` | SD-64 badge, tokenization field label on card number, checkout session raw doc |
| Login | All 8 demo user cards with role badges and BIAN IDs |

---

## 12. Login UX — Enhanced (Ch-05)

### 12.1 Business Mode Login (Debug OFF)

Standard credential form — unchanged from the current implementation. A subtle "Demo hints?" toggle reveals available usernames without passwords.

### 12.2 Debug Mode Login (Debug ON)

The credential form is replaced by a full user card grid. One-click login: clicking the card authenticates the user immediately via `POST /api/v1/auth/login` — no password entry required.

**Role badge color scheme:**

| Role | Color |
|---|---|
| `customer` | Blue |
| `level1_analyst` | Amber |
| `level2_investigator` | Orange |
| `security_auditor` | Red |
| `merchant_officer` | Purple |

In debug mode, each card also shows the BIAN reference IDs:
- `partyInstanceReference` (SD-13 Party anchor)
- `customerAuthenticationInstanceReference` (SD-91 CustomerAuthentication)

### 12.3 Demo Users (Post Ch-05 — 8 Total)

| Display Name | Username | Role | Department | Party Ref |
|---|---|---|---|---|
| Alex Johnson | `customer@demo.com` | customer | — | PTY-001 |
| David Chen | `customer2@demo.com` | customer | — | PTY-057 |
| Amara Okafor | `customer3@demo.com` | customer | — | PTY-058 |
| Lena Fischer | `customer4@demo.com` | customer | — | PTY-059 |
| Level 1 Analyst | `analyst@bank.demo` | level1_analyst | Fraud Detection Services | — |
| Level 2 Investigator | `investigator@bank.demo` | level2_investigator | Fraud Investigation | — |
| Security Auditor | `auditor@bank.demo` | security_auditor | Compliance | — |
| Rachel Torres | `officer@bank.demo` | merchant_officer | Merchant Acquiring | PTY-056 |

All passwords: `demo1234`

---

## 13. Merchant Onboarding UX (Ch-05)

### 13.1 Route Structure

| Route | Role | Purpose |
|---|---|---|
| `/system/merchant` | `customer` | Apply for merchant account OR view active merchant portal |
| `/system/merchant/review` | `merchant_officer`, `security_auditor` | Review queue — approve or reject applications |

### 13.2 Customer Flow — Submitting a Merchant Application

**State A: Customer has no linked merchant — Application entry point**

```
Merchant Portal
You don't have a merchant account yet.

[ Request Merchant Account ]

Processing fees: 2.9% + $0.30 per transaction
Settlements: T+2 business days
```

**Merchant Application Form** (with debug mode test data presets):

In debug mode, a "Load test data" dropdown appears above the form with 3 presets:

| Preset | Business Name | MCC | Volume | Type |
|---|---|---|---|---|
| Freelancer | Ana Reyes Consulting | 7392 Management Consulting | $8,000/mo | Sole Proprietorship |
| Online Store | CubaShop Digital | 5999 General Merchandise | $25,000/mo | LLC |
| Restaurant | Espresso Works Ltd | 5812 Eating Places | $15,000/mo | LLC |

Form fields with debug labels (shown only when debug ON):

| Field | Debug Label | BIAN Field |
|---|---|---|
| Business Name | `unencrypted · SD-89 BQ: MerchantType` | `merchantName` |
| Tax ID (EIN) | `QE:none 🔒 · PCI DSS Req 3.5.1` | `merchantTaxId` |
| Industry (MCC) | `unencrypted · ISO 18245` | `merchantCategoryCode` |
| Monthly Volume | `unencrypted` | `merchantExpectedMonthlyVolume` |
| Settlement Schedule | `unencrypted` | `merchantSettlementSchedule` |

The Submit button info panel (debug mode):
```
BIAN Action Term:   Initiate
HTTP Endpoint:      POST /api/v1/merchants
MongoDB Operation:  insertOne → merchantAgreementProcedure
PCI DSS:            Req 12.8 — Document agreement with service providers
Business Logic:     Sets merchantAgreementStatus = under_review.
                    Notifies Merchant Acquiring department for KYB review.
```

**State B: Application under review**

```
Application Status: [⏳ Under Review]

Business Name:  Espresso Works Ltd
Industry:       Food Service (MCC 5812)
Submitted:      2026-06-10 at 14:23

A Merchant Acquiring officer will review your application
within 2 business days.
```

**State C: Approved — Active merchant portal**

The existing merchant portal view from Ch-04 (checkout sessions, payment links, API keys, webhooks tab). Status badge: `[✓ Active]`.

### 13.3 Merchant Officer Flow — Review Queue

Route: `/system/merchant/review`

**Pending Applications List:**

Each application card shows:
- Merchant name, owner name (Party reference), MCC, monthly volume, submission date.
- Status badge: `[⏳ Under Review]`.
- KYB Review Notes text input.
- `[ ✓ Approve ]` and `[ ✗ Reject ]` buttons.

On approve: calls `PATCH /api/v1/merchants/:id/review` with `{ action: 'approve', reviewNote }`. Card status badge transitions to `[✓ Agreed]`.

On reject: calls `PATCH /api/v1/merchants/:id/review` with `{ action: 'reject', reviewNote }`. Card status badge transitions to `[✗ Rejected]`.

In debug mode, each card shows:
- `merchantAgreementInstanceReference` (SD-89 FK).
- BIAN badge: `SD-89 · Merchant Relations · Control`.
- Approve button info panel:
  ```
  BIAN Action Term:   Control
  HTTP Endpoint:      PATCH /api/v1/merchants/:id/review
  MongoDB Operation:  updateOne — set status: agreed, populate review metadata
  PCI DSS:            Req 12.8 — Documented approval by authorized officer
  Req 7.1:            Only merchant_officer role can approve (least privilege)
  ```
