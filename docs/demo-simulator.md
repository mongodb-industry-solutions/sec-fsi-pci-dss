# Demo Modes: UX Flow Design

**Project:** FSI PCI DSS Payment Security Demo
**Status:** Approved — Multi-method simulator in progress · Card Authorization integration + Full DB cycle planned (see `tmp/dev.simulator.plan.md`)
**Last updated:** 2026-06-11
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

### 3.0 Pre-Simulation Selector (Step 0)

Before any payment flow starts, the presenter selects **which integration pattern to demonstrate** and **which story to tell**. This screen replaces the static landing text with an interactive selector.

```
┌──────────────────────────────────────────────────────────────────┐
│  🎬 Simulator Mode — Configure your demo                         │
│                                                                  │
│  How should the payment be made?                                 │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│  │  💳 API Payment  │ │  🔀 Redirection  │ │  🔗 Payment Link │ │
│  │  Card            │ │  Payment         │ │                  │ │
│  │  SD-64 · Order   │ │  Checkout Sess.  │ │  Shareable URL   │ │
│  │  [Selected ✓]    │ │                  │ │                  │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ │
│  ┌──────────────────┐                                            │
│  │  📦 InSite       │                                            │
│  │  Payment         │                                            │
│  │  [Coming Soon]   │                                            │
│  └──────────────────┘                                            │
│                                                                  │
│  Which story?                                                    │
│  ┌──────────────────────┐ ┌──────────────────────┐              │
│  │ 👤 Luis Fernandez    │ │ 👤 María González     │              │
│  │ €850 · TechGadgets   │ │ €45 · Supermercado   │              │
│  │ [🔴 Fraude HIGH]     │ │ [🟢 Legítima]         │              │
│  └──────────────────────┘ └──────────────────────┘              │
│  ┌──────────────────────┐                                        │
│  │ 👤 Ahmed Khalil      │                                        │
│  │ €499 · GameZone      │                                        │
│  │ [🟡 Caso límite]     │                                        │
│  └──────────────────────┘                                        │
│                                                                  │
│  Story: Luis makes a high-value electronics purchase.            │
│  It triggers fraud detection → L1 escalates → L2 resolves.      │
│                                                                  │
│  [Start Demo →]  (disabled until method + scenario selected)     │
└──────────────────────────────────────────────────────────────────┘
```

**Config source:** `frontend/src/config/simulator-methods.json` — controls which methods and scenarios are visible. Setting `enabled: false` hides a method; `comingSoon: true` shows a disabled card.

**State persistence:** Selections are stored in `sessionStorage` (`sim_method`, `sim_scenario`) and survive navigation within the simulator. Cleared on "Restart Simulation."

**Payment methods:**

| ID | Label | Backend endpoint | Status |
|---|---|---|---|
| `api-card` | API Payment Card | `POST /api/v1/gateway/payments` | ✅ Enabled |
| `redirection` | Redirection Payment | `POST /api/v1/checkout/sessions` | ✅ Enabled |
| `payment-link` | Payment Link | `POST /api/v1/payment-links` | ✅ Enabled |
| `insite` | InSite Payment | N/A | 🔜 Coming Soon (disabled) |

**Pre-defined scenarios:**

| ID | Persona | Amount | MCC | Expected outcome |
|---|---|---|---|---|
| `luis-fraud` | Luis Fernandez | €850 | 5734 Computer/Software | Fraud HIGH → L1→L2 investigation |
| `maria-legit` | María González | €45 | 5411 Grocery | No fraud → clean confirmation |
| `ahmed-border` | Ahmed Khalil | €499 | 5945 Toys/Games | Borderline score → L1 can resolve |

### 3.1 Route Structure

```
/                                        Landing (mode selector)
/simulator                               Step 0: method + scenario selector
/simulator/payment                       Payment flow (branches by method)
/simulator/payment/callback              postMessage bridge for iframe flows
/simulator/investigation                 Analyst dashboard
/simulator/investigation/:caseId         Case detail (auto-loaded)
/simulator/audit                         Audit trail viewer (v2)
```

**Note:** `/simulator/payment/callback` is a standalone page (no simulator layout). It receives the redirect from the hosted payment page (inside an iframe) and sends a `window.parent.postMessage` to the parent simulator. It does not render any navigable UI.

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

The payment page (`/simulator/payment`) branches on `sim_method` from sessionStorage.

#### 3.3a — API Payment Card (existing flow)

Pre-fills Step 1 with the selected scenario's `paymentData`. The 3-step wizard is unchanged.

#### 3.3b — Redirection Payment (iframe flow)

The simulator acts as a **merchant** that creates a checkout session and embeds the hosted payment page in an iframe — demonstrating exactly how an external integration partner would use the PSP.

```
┌─────────────────── Simulator: Redirection Payment ──────────────┐
│  Step: Merchant creates checkout session                         │
│  POST /api/v1/checkout/sessions                                  │
│  returnUrl = /simulator/payment/callback?status=success&...      │
│                                                                  │
│  ┌────────── 🛒 TechGadgets Ltd. — Secure Checkout ──────────┐  │
│  │  Order: Laptop Pro 16 + accessories   Total: €850.00      │  │
│  │  ─────────────────────────────────────────────────────    │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │  [iframe: /gateway/checkout/{sessionId}]         │    │  │
│  │  │  (real hosted payment page — not a mock)         │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │  🔒 Secure payment powered by LeafyBank PGW              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ℹ️ This iframe loads the real /gateway/checkout page —          │
│     the same code your integration partner embeds.               │
└──────────────────────────────────────────────────────────────────┘
```

**postMessage protocol:**
1. Checkout session created with `returnUrl = {origin}/simulator/payment/callback`
2. `/gateway/checkout/[sessionId]` iframe: on success, `router.push(redirectUrl)` navigates the iframe to `/simulator/payment/callback?status=success&session={id}`
3. `/simulator/payment/callback` page (standalone, no layout) fires:
   ```javascript
   window.parent.postMessage(
     { type: 'sim_payment_complete', status: 'success', sessionId: id },
     window.location.origin   // origin-validated
   )
   ```
4. Parent simulator receives message, validates origin, advances to confirmation

**Why same-origin iframe:** Both the simulator and `/gateway/checkout` are served by the same Next.js app on the same origin. No CORS or CSP headers block this. This is also exactly how a real merchant integration would work (the PSP's hosted payment page is loaded from the PSP domain).

#### 3.3c — Payment Link (polling flow)

The simulator creates a payment link and previews it inline — demonstrating the shareable URL pattern.

```
┌─────────────────── Simulator: Payment Link ─────────────────────┐
│  📎 Payment Link Created                                         │
│  https://pay.leafybank.demo/lnk/ABC123DEF456                     │
│  [Copy URL]  [Open in new tab]                                   │
│                                                                  │
│  Share via: [Email] [WhatsApp] [QR Code]  (mockup badges)        │
│                                                                  │
│  Preview — what your customer sees:                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  [iframe: /pay/{code}]                                   │   │
│  │  (real payment link page — customer fills card here)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ⏳ Waiting for payment... (polls every 2s, max 2 min)           │
└──────────────────────────────────────────────────────────────────┘
```

Completion detected via polling `GET /api/v1/payment-links/{code}`. When status = `completed`, simulator advances to confirmation.

### 3.4 Step 1: Card Details

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
│  │  Card token           →  pm_7xB2kp1q         (plaintext)  │  │
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
│  Card:   pm_7xB2kp1q        →  "paymentCardReference":          │
│                                   "pm_7xB2kp1q"                 │
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

### 3.6 Presenter Script (12-minute path — Redirection Payment, Luis scenario)

| Min | Action | Talking point |
|---|---|---|
| 0:00 | Open `/simulator` landing | "This is a digital bank running entirely on MongoDB Atlas." |
| 0:20 | Select **Redirection Payment** method | "Let's demonstrate the integration pattern that external merchants use to connect their checkout to our PSP." |
| 0:40 | Select **Luis — Alto valor** scenario | "Luis is buying a €850 laptop. This amount will trigger our fraud detection." |
| 1:00 | Click **Start Demo →** | "We're now acting as the merchant. Watch what happens." |
| 1:15 | Simulator creates checkout session | "The merchant calls our API: POST /checkout/sessions. The PSP returns a hosted payment page URL." |
| 1:30 | Merchant branding wrapper appears | "The merchant embeds our hosted page in an iframe — that's what you see here. This is the actual PSP-hosted payment page, not a mock." |
| 2:00 | Fill card in iframe | "Luis enters his card details. The raw PAN never leaves the browser — a token is generated client-side." |
| 2:30 | Click Pay in iframe | "Payment submitted inside the iframe. The PSP tokenizes and processes." |
| 3:00 | postMessage fires, simulator advances | "The checkout page redirects to our callback URL. The merchant's system receives the result." |
| 3:30 | Fraud alert appears | "Amount €850 exceeded the threshold. A fraud case was auto-created." |
| 4:00 | Auto-redirect to investigation | "We're now the fraud analyst. The case appeared automatically." |
| 4:30 | Run email search | "I search by Luis's email — that field is encrypted in Atlas." |
| 5:00 | Results appear | "Found the record. Server matched ciphertext to ciphertext — no decryption." |
| 5:30 | Click Raw Atlas Document | "This is what Atlas actually stores. Ciphertext blobs. MongoDB has zero access to the plaintext." |
| 6:00 | L1 view — encryption matrix | "Level 1 can search by email, phone, account ref — all encrypted. Cannot see address or gov ID." |
| 7:00 | Escalate to L2 | "Score 85/100 exceeds the L1 authority threshold. Sarah escalates." |
| 7:30 | L2 review | "Michael gets the escalation token. He can now decrypt address and gov ID using a different DEK." |
| 8:00 | Show sensitive fields | "742 Evergreen Terrace... These are decrypted client-side only. Atlas never saw the plaintext." |
| 8:30 | L2 resolves | "Fraud confirmed. Card revoked. Chargeback initiated. Audit trail sealed." |
| 9:00 | Customer view | "Luis sees: fraud confirmed, full refund, new card in transit." |
| 9:30 | Recap | "End-to-end encrypted. Queryable without decryption. Keys are yours. Integration via iframe or direct API. Audited by default." |

**Alternative 5-minute path (API Card, María scenario):**

| Min | Action | Talking point |
|---|---|---|
| 0:00 | Select API Card + María | "Direct API integration. €45 grocery — legitimate transaction." |
| 0:30 | Complete 3 steps | "Encrypted in browser. Server sees ciphertext." |
| 1:30 | No fraud alert | "Below threshold, low-risk MCC. Clean confirmation." |
| 2:00 | Show raw Atlas document | "Even a clean transaction — all PII is ciphertext in Atlas." |
| 2:30 | Recap | "Zero-trust storage. Query without decrypt. Works for every transaction, not just fraud cases." |



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
│             └ diego.sans@back.es      (Security Auditor)  │
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

The username dropdown (shown in **debug mode**) lists the **featured roster** from the database via `GET /api/v1/auth/users?featured=true`. Selecting a user auto-fills the password with the shared demo credential (`DEMO_PASSWORD`). The domain selector defaults to `local` (JWT against MongoDB). The MS Entra ID entry is wired but not active in v1. See §12.3 for the full featured roster (13 users).

### 4.3 Pre-defined Users and Roles

The curated featured roster is the authoritative list — see **§12.3 Demo Users** for the full table (4 customers, 2 L1, 2 L2, 2 auditors, 2 merchant officers, 1 manager). A representative subset:

| User | Email | Role | Description |
|---|---|---|---|
| Luis Fernandez | luis.fernandez@back.es | customer | Retail: card transactions and open cases; fraud scenario |
| Amara Okafor | amara.okafor@back.es | customer | Owns the simulator merchant (Okafor Digital Services) |
| Sarah Chen | sarah.chen@back.es | level1_analyst | L1 Fraud Analyst: default investigation view |
| Michael Obi | michael.obi@back.es | level2_investigator | L2 Investigator: receives escalated cases |
| Diego Sans | diego.sans@back.es | security_auditor | Read-only: audit log and system status |

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
| 8 | Multi-method simulator: method + scenario selection | **In progress** — see `tmp/dev.simulator.plan.md` |
| 9 | InSite Payment | Deferred: `enabled: false` in `simulator-methods.json`. Requires embedded widget SDK — future iteration. Not blocking current roadmap. |

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

**Tokenization (demo):** Frontend generates `pm_<12 random hex><last4>` as the card token. Raw PAN is never sent to the backend. This is the PCI DSS SAQ A pattern.

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

### 12.3 Demo Users (Current — curated featured roster)

The **featured roster** (13 users, `customerAuthenticationDemoFeatured: true`) drives the debug-mode user picker in Application mode and the Simulator. The full seed contains more users (e.g. Lena Fischer, Priya Patel, Marco Rossi, Maria Garcia, Ahmed Hassan) which remain available for ad-hoc login/testing but are not surfaced in the picker. `GET /api/v1/auth/users?featured=true` returns only the featured set. All emails use the `@back.es` domain.

| Display Name | Username | Role | Party Ref | Simulator use |
|---|---|---|---|---|
| Luis Fernandez | `luis.fernandez@back.es` | customer | b0000001 | Fraud scenario (€850) |
| Julia Santos | `julia.santos@back.es` | customer | b0000002 | Legit scenario (€45) |
| Amara Okafor | `amara.okafor@back.es` | customer | b0000058 | Borderline scenario (€499); **owns the simulator merchant** |
| Carlos Garcia | `carlos.garcia@back.es` | customer | b0000060 | — |
| Sarah Chen | `sarah.chen@back.es` | level1_analyst | b0000051 | L1 escalation actor |
| Anna Kowalski | `anna.kowalski@back.es` | level1_analyst | b0000062 | — |
| Michael Obi | `michael.obi@back.es` | level2_investigator | b0000052 | L2 approval/resolution actor |
| James Wright | `james.wright@back.es` | level2_investigator | b0000063 | — |
| Diego Sans | `diego.sans@back.es` | security_auditor | b0000053 | — |
| Sophie Martin | `sophie.martin@back.es` | security_auditor | b0000064 | — |
| Rachel Torres | `rachel.torres@back.es` | merchant_officer | b0000056 | KYB reviewer |
| David Chen | `david.chen@back.es` | merchant_officer | b0000057 | — |
| Alex Rivera | `alex.rivera@back.es` | manager | b0000070 | Integration Hub admin |

All passwords: `demo-password` (shared bcrypt hash; the plaintext is a fixed demo convention, centralized as `DEMO_PASSWORD` in the frontend).

**Simulator merchant:** Okafor Digital Services (`m0000002`), owned by Amara Okafor (`b0000058`, KYB-verified). All simulator payments are processed through this merchant.  
**Simulator authentication:** the Simulator obtains a **real JWT per role** via `POST /api/v1/auth/login` (no auth bypass). Escalate (L1) → approve (L2) → resolve actions hit the real `/api/v1/fraud/*` endpoints and persist — a case escalated in the Simulator appears as `escalated` when logging into Application mode as an L2 user.  
**Simulator history:** after a simulator payment, the payer (`luis`/`julia`/`amara`) can log in to `/system/payment/history` and see the transaction, read from the real API (`GET /api/v1/transactions/all`, scoped to their own account). The previous `localStorage` mirror was removed.

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

---

## 14. Multi-Method Simulator (Ch-06)

Adds payment method selection and scenario selection to the Simulator before the payment flow starts. Implements Redirection Payment via a real same-origin iframe and Payment Link via inline iframe + polling. InSite Payment is deferred.

### 14.1 Simulator Config File

**Location:** `frontend/src/config/simulator-methods.json`

This file is the single source of truth for which methods and scenarios are visible in the Simulator. Editing this file is the only change required to show/hide a method or scenario — no code changes needed.

**Structure:**
```json
{
  "version": "1.0",
  "paymentMethods": [
    { "id": "api-card",     "label": "API Payment Card",   "enabled": true },
    { "id": "redirection",  "label": "Redirection Payment","enabled": true },
    { "id": "payment-link", "label": "Payment Link",       "enabled": true },
    { "id": "insite",       "label": "InSite Payment",     "enabled": false, "comingSoon": true }
  ],
  "scenarios": [
    { "id": "luis-fraud",   "outcome": "fraud",      "paymentData": { "amount": "850.00", ... } },
    { "id": "maria-legit",  "outcome": "clear",      "paymentData": { "amount": "45.00",  ... } },
    { "id": "ahmed-border", "outcome": "borderline", "paymentData": { "amount": "499.00", ... } }
  ]
}
```

### 14.2 Simulator sessionStorage State

All simulator selections persist across navigation with a `sim_` prefix:

| Key | Type | Description |
|---|---|---|
| `sim_method` | string | Selected payment method ID |
| `sim_scenario` | string | Selected scenario ID |
| `sim_step` | number | Current step in the payment flow |
| `sim_payment_step3` | JSON | Confirmation result (existing key, unchanged) |
| `sim_checkout_session` | JSON | `{ sessionId, paymentPageUrl, amount, merchant }` for redirection flow |
| `sim_payment_link` | JSON | `{ code, url, amount, merchant }` for payment link flow |

**Manager:** `frontend/src/components/simulator/SimulatorStateManager.ts` provides typed `getState()`, `setState(partial)`, `clearState()` helpers.

### 14.3 Callback Route — `/simulator/payment/callback`

**Layout:** Standalone — no simulator header/nav (uses its own layout that returns children unwrapped).

**Purpose:** Acts as the postMessage bridge between the hosted checkout page (running inside an iframe) and the parent simulator page.

**Flow:**
1. The `/gateway/checkout/[sessionId]` page completes payment and calls `router.push(redirectUrl)` where `redirectUrl = /simulator/payment/callback?status=success&session={id}`
2. The iframe navigates to this callback page
3. On mount, the page reads `status` + `session` from URL params and fires:
   ```javascript
   window.parent.postMessage(
     { type: 'sim_payment_complete', status, sessionId },
     window.location.origin   // origin-validated by parent
   )
   ```
4. If navigated to directly (not in iframe): shows "Return to /simulator" message

**Security:** `window.location.origin` is passed as `targetOrigin`. Parent validates `event.origin === window.location.origin` before acting.

### 14.4 Backend Auth Extension for Simulator

Checkout sessions and payment links require a merchant JWT. In Simulator mode:

**Headers sent by simulator frontend:**
- `X-Simulator-Mode: true`
- `X-Demo-Merchant-Id: {merchantId}` — ID of the pre-seeded simulator merchant

**Backend middleware extension** (`vendors/middleware/auth.ts`): when `X-Simulator-Mode: true`, populate `req.merchant` from the value of `X-Demo-Merchant-Id` (after verifying the merchant exists in DB). This extends the existing `X-Demo-Role` simulator pattern.

**Env var required:** `SIMULATOR_MERCHANT_ID` — UUID of the pre-seeded merchant used for simulator flows. Added to `.env.example`.

### 14.5 New Frontend Components

| Component | Location | Purpose |
|---|---|---|
| `PaymentMethodSelector` | `components/simulator/` | Grid of method cards, enabled/disabled states |
| `ScenarioSelector` | `components/simulator/` | 3-card strip with outcome badges |
| `RedirectionPaymentFlow` | `components/simulator/` | Creates checkout session, renders iframe |
| `MerchantBrandingWrapper` | `components/simulator/` | Merchant site mockup wrapping the iframe |
| `PaymentLinkFlow` | `components/simulator/` | Creates link, shows URL+QR mockup, polls status |
| `SimulatorStateManager` | `components/simulator/` | sessionStorage read/write helpers |

**Implementation plan:** `tmp/dev.simulator.plan.md` — 8 phases with pre/post checklists, TDD test specs, and risk register.

### 14.6 Simulator Endpoint Namespace (/api/v1/system/simulator/)

Simulator frontend components route all payment operations through a dedicated backend namespace that does not require a merchant JWT. These endpoints are gated by `NODE_ENV !== 'production'`.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/system/simulator/checkout-session` | Creates a checkout session using `SIMULATOR_MERCHANT_ID`; accepts `customerEmail` for transaction binding |
| `POST /api/v1/system/simulator/payment-link` | Creates a payment link for the simulator merchant |
| `GET /api/v1/system/simulator/transactions/:email` | Returns recent transactions for a user by email (QE search) |

**Why separate from PSP API:** The PSP-facing endpoints (`/api/v1/checkout/sessions`, `/api/v1/payment/links`) require a valid merchant JWT. In simulator mode, there is no logged-in merchant user. These system endpoints pre-fill the merchant context from the environment variable, keeping the PSP API contract clean.

**Env var:** `SIMULATOR_MERCHANT_ID=m0000003-0000-4000-8000-000000000003`

### 14.7 Full DB Transaction Cycle (Real Payment Guarantee)

Every simulator payment must produce a real MongoDB document in `cardTransactionLog` that is:
- Linked to the correct `customerAgreementInstanceReference` (via `customerEmail` on the checkout session)
- Visible in `/system/payment/history` when the payer logs in
- Visible to L1/L2 analysts in the investigation dashboard
- Associated with a `fraudDiagnosisCase` if fraud criteria are met

**accountReference fix:** The checkout service historically set `accountReference = cardToken` (random), producing orphaned transactions. The fix: `accountReference = session.checkoutSessionCustomerEmail ?? cardToken`. The `customerEmail` is passed by the simulator when creating the session.

**localStorage bridge:** `simulatorHistory.ts` writes to `localStorage` as a UI-fast fallback. This remains in place but is secondary — the DB record is the authoritative source.

---

## 15. Card Authorization Integration (SD-15)

### 15.1 Overview

A real payment gateway calls the card issuer for authorization before confirming a transaction. This demo models that step via the Integration Hub's `card_authorization` provider category (SD-193 External Provider + SD-15 Card Authorization).

**Authorization flow (Redsys/PayPal-inspired):**

```
Simulator/Merchant   Gateway (checkout.service)    CARD_AUTH Provider
       │                        │                       │
       │── Pay form submit ────▶│                       │
       │                        │── authorize() ───────▶│
       │                        │   { cardToken,        │  Stub: always 0000
       │                        │     amount,           │  Real: Redsys REST /
       │                        │     currency, mcc }   │        Stripe /
       │                        │                       │        PayPal
       │                        │◀── AuthResponse ──────│
       │                        │   { approved,         │
       │                        │     responseCode,     │
       │                        │     authCode }        │
       │                        │                       │
       │                        │── createTransaction() │ (only if approved)
       │                        │── FDS fraud check     │
       │◀── result / case ID ───│                       │
```

### 15.2 Response Codes (Redsys-aligned)

| Code | Meaning | Demo behavior |
|---|---|---|
| `0000` | Approved | Transaction proceeds normally |
| `0101` | Card expired | HTTP 402, no transaction created |
| `0180` | Unknown card / invalid token | HTTP 402, no transaction created |
| `0190` | Denied — generic | HTTP 402, no transaction created |
| `9915` | Payment cancelled | HTTP 402, no transaction created |

### 15.2 Response Codes (Redsys-aligned)

| Code | Meaning | Demo behavior |
|---|---|---|
| `0000` | Approved | Transaction proceeds normally |
| `0101` | Card expired | HTTP 402, no transaction created |
| `0180` | Unknown card / invalid token | HTTP 402, no transaction created |
| `0190` | Denied — generic | HTTP 402, no transaction created |
| `9915` | Payment cancelled | HTTP 402, no transaction created |

### 15.3 Stub Behavior — Scenario-Driven

The stub honors the `cardAuthOutcome` field on the scenario prefill:

| Scenario prefill `cardAuthOutcome` | Stub returns | UI behavior |
|---|---|---|
| `'approved'` (default) | responseCode `0000` | Transaction proceeds |
| `'declined'` | responseCode `0190` | HTTP 402, checkout shows "Card declined" |
| `'challenge'` | responseCode `0000` + `requiresChallenge: true` | 3DS mock screen shown before transaction |

All current simulator scenarios use `'approved'`. A future "declined card" scenario can set `'declined'` without code changes.

### 15.4 3DS Challenge Mock Screen

When a scenario has `cardAuthOutcome: 'challenge'`, the hosted checkout page shows an intermediate 3DS verification step:

```
┌───────────────────────────────────────────────────────┐
│  🔐 Additional Verification Required                   │
│                                                        │
│  Your bank is requesting identity verification.        │
│  Enter the one-time code sent to your device.          │
│                                                        │
│  OTP Code  [ 1 2 3 4 5 6 ]  (pre-filled for demo)     │
│                                                        │
│  [ Verify →]                                           │
│                                                        │
│  ℹ️  This is EMV 3DS V2 (simulated)                   │
│     Real flow: cardholder redirects to ACS URL         │
└───────────────────────────────────────────────────────┘
```

After [Verify], the challenge token is submitted via `POST /api/v1/checkout/{sessionId}/pay-challenge` and the transaction is created. The `cardAuthorizationRecord` is updated with `challengeCompletedAt`.

**Presenter talking point:** "In production with a real issuer configured, this screen would redirect to the bank's ACS — the customer authenticates via their bank app. Here we simulate that step. The important thing is the architecture: authorization happens BEFORE the transaction is recorded."

### 15.4 CardAuthorizationConfig Interface

```typescript
interface CardAuthorizationConfig {
  merchantCode: string;           // Redsys: FUC code | Stripe: merchant ID
  terminalNumber?: string;        // Redsys-specific terminal
  authorizationUrl?: string;      // Override endpoint for sandbox testing
  signatureVersion: 'HMAC_SHA256' | 'HMAC_SHA512_V2';
  enableThreeDS: boolean;         // Request EMV 3DS V2 challenge flow
  mockMode: boolean;              // true = never calls external
  simulatorMode?: 'always_approve' | 'scenario_driven';
}
```

### 15.5 Storage — `cardAuthorizationRecord` (SD-15 New Collection)

Every authorization request creates a document in `cardAuthorizationRecord`. No QE — no PII, no CHD. Linked to `cardTransactionLog` via `cardTransactionInstanceReference` (null if declined).

The Raw Atlas Document toggle on the transaction detail page shows both documents side-by-side:
- `cardTransactionLog` — the transaction (with QE-encrypted PII fields)
- `cardAuthorizationRecord` — the authorization result (plaintext, no sensitive data)

**Presenter talking point:** "Notice two documents: the authorization record shows the bank approved the card — response code 0000. The transaction record shows the fraud system then flagged it. These are two different steps: the issuer said 'yes', but our fraud engine said 'investigate'. PCI DSS requires both steps to be auditable independently."

| Aspect | Detail |
|---|---|
| BIAN Service Domain | SD-15 Card Authorization — `CardAuthorizationRecord` |
| BIAN Behavior Qualifier | `Authorize` |
| PCI DSS Req 3.3 | CVV is NOT passed to the authorization provider (demo constraint; documented) |
| PCI DSS Req 3.4 | Only `cardToken` (surrogate) is sent — never raw PAN |
| PCI DSS Req 6.4 | Authorization calls use TLS; HMAC-SHA256 signature on payload |
| PCI DSS Req 10.2 | Authorization request/response logged in `cardAuthorizationRecord` collection (SD-15) |

### 15.6 External Provider Configuration (Integration Hub UI)

Admins can configure a real external CARD_AUTH provider from the Integration Hub admin panel:

```
Provider Type: Card Authorization (SD-15)
Provider Name: [e.g., Redsys REST / Stripe Issuing / PayPal]
Merchant Code: [FUC or merchant ID]
Authorization URL: [sandbox endpoint]
Signature: HMAC_SHA512_V2 (Redsys) or HMAC_SHA256
Mock Mode: ☑ (uncheck to enable real calls)
```

When `mockMode: false` and a valid URL is configured, the dispatch service sends real authorization requests. No code changes required — the adapter resolves from the hub configuration at runtime.

---

## 16. David Chen — Merchant Scenario

### 16.1 Role

David Chen (`david.chen@demo.com`) is the owner of **Fischer Web Studio** (`m0000003`), an active merchant in the system with KYB verified. He represents the merchant perspective in the demo.

**Login:** `david.chen@demo.com` / *(password redacted)*  
**Role:** `merchant_officer`  
**Post-login redirect:** `/system/merchant` — Fischer Web Studio merchant portal pre-selected.

### 16.2 What David Sees

After login, David accesses the standard merchant portal (Ch-04 §10.4):
- **Checkout Session tab:** Create checkout sessions (same as simulator scenarios use)
- **Payment Links tab:** View active links, create new ones, deactivate
- **API Keys tab:** Manage API credentials
- **Webhook tab:** Configure callback endpoint for payment events

**Webhook events received:** `checkout.completed`, `payment_link.completed` — payload now includes `cardToken`, `maskedPan`, `fraudCaseCreated`, `caseId` (if applicable).

### 16.3 Presenter Talking Point

> "David is a merchant who integrated his web studio billing with our gateway. He doesn't see card data — only the result: paid, amount, fraud flag. When Luis's €850 payment triggered a fraud case, David got a webhook: `fraudCaseCreated: true`. He doesn't need to do anything — the bank handles the investigation. This is the correct separation of responsibility under PCI DSS."

### 16.4 Demo Flow (David perspective)

| Step | Action | What David sees |
|---|---|---|
| 1 | Log in as David | Fischer Web Studio portal |
| 2 | Go to Webhook tab | Configured endpoint |
| 3 | (After simulator ran Luis scenario) | Webhook log: `checkout.completed, amount: €850, fraudCaseCreated: true` |
| 4 | Go to Payment Links tab | Luis's payment link shows status: `completed` |
| 5 | Present Debug Mode | Shows raw MongoDB document — `merchantName` plaintext, customer fields encrypted |

## Bank transfer UX (/system/transfer/bank) — add-on (dev plan v17)

Two tabs:
- Registered account: send to an own account or a saved contact; no bank details required. Executes as
  an external bank transfer (async): funds are held on submit and settle after T+N ("pending settlement").
- New bank account: enter destination country, IBAN/routing/account and BIC. The rail (SEPA/ACH/SWIFT) is
  auto-detected and shown as a badge with the quoted fee; details validate live (preview endpoint). "Send
  wire" submits and the success screen polls live status (pending -> settled/failed). A "recurring (Direct
  Debit)" option creates a SEPA SDD / ACH SDD mandate with a chosen frequency.

*Added 2026-07-04 (v17.1).*

## v28 — Request to Pay (RTP), shared QR, and VoP admin

**Real system (`/system/**`):** RTP is "a transfer that needs the payer's approval", so it lives inside
the Transfer area (no separate silo). Transfer hub gains a **Request to Pay** card → `/system/transfer/rtp`
(payee creates a request; on create it is presented to the payer and a shared QR is offered). The payer sees
**"Requests awaiting your approval"** directly on the Transfer hub (`RtpPendingInbox`): approve (with a
funding-account selector) runs funds check + FDS/HRP/AML + VoP then creates the linked P2P transfer, or
reject. Notifications fire on delivery (payer) and approval/settlement (payee); the alert clears on approve/reject.

**VoP admin (`/system/admin/modules/vop`):** dedicated data-driven config dashboard (match thresholds,
matching strategy toggles, decision policy, market gating), editable by admin/manager like FDS. VoP also
appears under `/system/admin/providers/groups` and its `vop.verification.completed` events + dispatch logs
are queryable in `/system/audit-events`.

**Merchant app (`merchant/`):** `/request-to-pay` (scope-gated `read:rtp`/`write:rtp`) shows incoming
requests to approve/reject and sent requests with status; Nav link gated by scope. Approve/reject reuse the
authenticated OAuth session (no CIBA).

*Added 2026-07-17 (v28).*
