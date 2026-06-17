## **Architecture Reference Document for PSP Systems**

### **1. Event-Driven Architecture (EDA)**  
The entire PSP system is to be built and operated based on an Event-Driven Architecture. This approach ensures efficient processing of business flows asynchronously, with the **Event Bus** serving as the core component responsible for managing the sequence of events.

#### **Key Concepts:**  
1. **Event Bus Core:**  
   A centralized component that emits and manages events, facilitating business processes. Each business process is represented as a sequence of events, which the system processes asynchronously.

2. **Business Process Examples:**  
   - **Payments:** API Payment, Redirection Payment, Payment Link.  
   - **User Validation:** Know Your Customer (KYC).  
   - **Merchant Validation:** Know Your Business (KYB).  
   - **Investigative Case:** Fraud analysis and merchant investigations.

3. **Process Definition:**  
   - **Sequence of Events:** Each business process defines a clear event sequence. The PSP core must use the Event Bus to emit events with the correct payloads at the appropriate steps of the process, ensuring proper handling by external or internal systems.  
   - **Process Identifiers:** Each business process must define a unique identifier (e.g., transaction ID, case reference) to track and manage all associated events. This facilitates system auditing, making it possible to trace the lifecycle of processes and responses.

---

### **2. Hexagonal Architecture**  
To ensure flexibility and scalability, the PSP system adopts a **Hexagonal Architecture**. This design allows seamless interaction between the core system and external modules or subsystems.

#### **Key Design Principles:**  
1. **Provider Categories:**  
   Integration is divided into the following distinct **categories**, which play specific roles within different business workflows:
   - Fraud Detection System (FDS)  
   - Human Resource Processes (HRP)  
   - Anti-Money Laundering (AML)  
   - Know Your Customer (KYC)  
   - Know Your Business (KYB)  
   - Card Issuer  
   - Credit Bureau  
   - Card Authorization  

2. **Provider Groups:**  
   - Each category defines a **Provider Group**, which is responsible for managing multiple providers with a common business goal.  
   - Providers within the same group respond to the same events but may offer different strategies for execution. For instance:
     - In the **Card Issuer** group, multiple providers may handle card validation events (e.g., CVV, PIN verification).  
     - The execution strategy may focus on default provider selection or fallback mechanisms, where the next provider in the group handles the request if the first one fails.

3. **Providers:**  
   - A **Provider** is equivalent to a **Port** in the Hexagonal Architecture. It defines the **inbound** and **outbound** behaviors for specific events it handles.  
   - Providers interact directly with external systems or modules for event processing.  

4. **Provider Event Configurations:**  
   - **Outbound Configuration:**  
     - Defines how outgoing attributes are mapped between the PSP system and external systems. For example:
       - If the PSP emits an event with a field `cvv`, but the external system expects `cvvData`, mapping ensures compatibility by transforming `cvv` into `cvvData`.  
       - Similar mapping applies to headers (e.g., transforming `authorization` into `X-Authorization`).  
     - Providers must configure security features like API Keys, HTTP action methods (POST, GET, etc.), retries, timeout settings, etc.  
     - Provider-specific configurations (e.g., security and data formats) must align with their category.  

   - **Inbound Configuration:**  
     - Defines how responses from external systems to specific events are processed via inbound callbacks.  
     - Mapping of inbound attributes ensures the system properly interprets external data.  
     - Security measures (e.g., authenticity checks, anti-spoofing techniques) must verify that the response comes from legitimate external systems.

5. **External Systems/Adapters:**  
   - External systems (referred to as **vendors**) act as adapters that implement the PSP-defined Ports.  
   - These systems must process requests and provide responses via the defined callback endpoints.

6. **Modules:**  
   - **Build-in Modules:**  
     - Internal implementations that provide basic functionality for providers without creating system dependencies.  
     - Modules act as adapters and should be configured via providers.  
     - Example: A "build-in card validator" module that supports CVV validation but can be easily replaced by external card issuer providers.  

   - **Configuration & Response Handling:**  
     - Modules must implement the inbound/outbound requirements of the provider for specific events.  
     - Callback URLs and configurations for modules are dynamic and should support easy replacement by external systems.

#### **Directory Structure:**  
- All **Provider Groups** must reside in:  
  `backend/src/modules`.  
- All **Build-in Modules** (vendors/internal adapters) must reside in:  
  `backend/src/vendors`.  
This distinction cleanly separates the **PSP core** from replaceable subsystems.

---

### **3. Pattern and System Design Rules**  

1. **Event Bus Implementation:**  
   - The Event Bus should provide an **in-memory MongoDB-based implementation** by default for simplicity and local deployment.  
   - Scalability through pluggable engines (e.g., RabbitMQ, Kafka, etc.) must be available via a **Strategy Pattern**. Configuration should allow easy switching between engines without requiring code changes.  
   - The PSP core and Provider Groups must interface with the global Event Bus without direct dependence on the underlying technology.

2. **Programming Paradigm:**  
   - The system follows **Object-Oriented Programming (OOP)** principles, utilizing interfaces and strong type definitions to maintain clarity and ensure extensibility.  
   - A strict **maximum inheritance depth of 3 levels** must be adhered to, avoiding anti-patterns. Functional programming may only be applied for extremely simple, localized tasks.

3. **PCI DSS Compliance:**  
   - All data flows and system interactions must strictly adhere to PCI DSS standards to ensure the security of sensitive payment information.

4. **Data Architecture Principles:**  
   - The system must follow the **BIAN (Banking Industry Architecture Network)** standards for data structure and information flow.  

---

### **4. Development Best Practices**  

1. **KISS Principle:**  
   - Keep code simple and avoid unnecessary complexity.  
   - Minimize duplication of code, variables, constants, models, interfaces, and collections.  
   - Reuse components whenever possible to simplify maintenance and scalability.

2. **Commenting Standards:**  
   - Use **JSDoc** format for comments.  
   - All documentation must be concise, written in English, and limited to 2 lines per comment. Avoid excessive commenting and refrain from including progress details in comments.

3. **Resource Efficiency:**  
   - Optimize resource usage for maximum performance.  
   - Prioritize system UX/UI responsiveness by minimizing latency and computational overhead.

---

### **5. Business Process Event Sequences**

This section is the **authoritative catalogue of events per business process**. Its purpose is to
standardize the choreography and to let us validate the flow *before* changing code. Every flow is
described as the real, code-backed sequence of `DomainEvent`s on the Event Bus.

#### **5.0 Event model and conventions**

- **Envelope (`DomainEvent`)** — `eventId` (uuid, idempotency key), `eventType` (dotted name),
  `occurredAt`, `correlationId` (the journey instance), `causationId` (cause -> effect),
  `businessProcess` (the journey class), `source` (emitting component), `actor`, `bian`, `payload`,
  `schemaVersion`, optional `transient`.
- **`correlationId` = the journey.** For a payment it is the `cardTransactionInstanceReference`
  (`txnId`); the investigation case reuses the same id so payment and investigation are one trail.
  For onboarding/card-management it is the entity reference (party / card / merchant).
- **`businessProcess`** is the *class* used to group events:
  `card_payment | fraud_investigation | card_management | customer_onboarding |
  merchant_onboarding | provider_integration | system`.
- **Naming standard:** `<domain>.<subject>.<action>[.<phase>]`, lowercase, dotted. Two phase
  suffixes only, always as a symmetric pair: **`.requested`** (an async ask) and **`.completed`**
  (its result). There are no separate success/failure event names — the outcome
  (`authorized | declined | match | clear ...`) travels in the `.completed` payload.
- **Start/end per business process.** Every business process has exactly one opening event
  (`<process>.requested`) and one closing event (`<process>.completed`). Between them, each provider
  interaction is its own `<provider>.<action>.requested -> <provider>.<action>.completed` pair. The
  process `*.completed` is emitted once **all** the provider `*.completed` events it depends on have
  arrived; its payload carries the aggregated outcome. This gives a uniform, auditable template for
  every flow (payment, KYC, KYB, investigation).
- **Causation chain.** Each provider `*.requested` sets `causationId = <process>.requested.eventId`;
  each provider `*.completed` sets `causationId = its own *.requested.eventId`; the process
  `*.completed` sets `causationId =` the last provider `*.completed`. The full cause->effect graph of
  a journey is therefore reconstructable from the store.
- **Persistence layers** (do not confuse them):
  1. `domainEvent` — the Event Bus store, the canonical correlated journey (queried by `correlationId`).
  2. `businessProcessEvent` / `complianceProcessEvent` — the audit ledger; every audit emit is also
     **mirrored** onto the bus (`mirrorEventToBus`, `eventType = processAction`).
  3. `externalProviderArrangementActionLog` — the outbound/inbound HTTP I/O with providers
     (`triggeredBy`), the request side of each `.requested`.
- **PCI DSS:** cardholder data (PAN/CVV/expiry) reaches the Card Issuer **only** via the provider
  dispatch HTTP body. It is **never** placed on the bus or in any of the three stores
  (`sanitizeDeep` strips it on publish; the pre-mapping payload is what gets logged). Req 3.2 / 10.7.

#### **5.1 `card_payment` — async two-phase authorization (core)**

`correlationId = txnId`. Phase 1 gates the authorization; Phase 2 runs post-auth (see 5.2).

```mermaid
sequenceDiagram
  participant API as PSP core
  participant Bus as Event Bus
  participant Saga as PaymentAuthorizationSaga
  participant Iss as Card Issuer (provider)
  participant FDS as Fraud Detection (provider)
  participant HRP as Sanctions/HRP (provider)

  API->>Bus: card.payment.authorization.requested (gatesExpected:[card.issuer,fds,hrp])
  Bus->>Saga: begin(journey)
  par Phase-1 gates (parallel, out-of-band)
    Bus->>Iss: card.issuer.validation.requested
    Iss->>Iss: dispatch (CHD, HTTP body only)
    Iss-->>Bus: card.issuer.validation.completed {outcome,responseCode}
  and
    Bus->>FDS: fds.scoring.requested
    FDS-->>Bus: fds.scoring.completed {outcome,reason}
  and
    Bus->>HRP: hrp.screening.requested
    HRP-->>Bus: hrp.screening.completed {outcome,reason}
  end
  Bus->>Saga: onGate x3 (aggregate verdicts)
  Saga->>Bus: card.payment.authorization.completed {outcome: authorized|declined}
```

| # | eventType | source | businessProcess | persisted | consumer / effect |
|---|---|---|---|---|---|
| 1 | `card.payment.authorization.requested` | `psp.core` | card_payment | yes | Saga `begin`; carries `gatesExpected` |
| 2a-req | `card.issuer.validation.requested` | `psp.core` | card_payment | yes | triggers issuer dispatch (CHD via HTTP only) |
| 2a-done | `card.issuer.validation.completed` | `callback.card-issuer` | card_payment | yes | Saga gate `card.issuer` |
| 2b-req | `fds.scoring.requested` | `psp.core` | card_payment | yes | triggers FDS dispatch |
| 2b-done | `fds.scoring.completed` | `callback.fds` | card_payment | yes | Saga gate `fds` |
| 2c-req | `hrp.screening.requested` | `psp.core` | card_payment | yes | triggers HRP/sanctions dispatch |
| 2c-done | `hrp.screening.completed` | `callback.hrp` | card_payment | yes | Saga gate `hrp` |
| 3 | `card.payment.authorization.completed` | `saga.payment-authorization` | card_payment | yes (+ audit mirror) | resolves SSE; `{outcome}` drives merchant `payment.callback`; triggers Phase 2 |

- **One start, one end.** `card.payment.authorization.requested` opens the journey;
  `card.payment.authorization.completed` closes it, emitted once **all** gate `*.completed` events are
  in. Its payload carries `outcome: authorized | declined` (+ `responseCode`, `decisionReason`) — no
  separate `payment.authorized` / `payment.declined`, no `transaction.authorized` / `.declined`. The
  closing event is mirrored to the audit ledger, so the compliance record is preserved.
- Each gate is a `*.requested -> *.completed` pair; the `*.completed` payload carries the per-gate
  `outcome` (no separate approved/declined event names). The HTTP dispatch to the provider is logged
  in `externalProviderArrangementActionLog` (the wire side of each `*.requested`).
- Gates are **fail-open** on transport error (only an explicit decline declines); the HRP/sanctions
  gate is the regulatory hard stop. The internal Card Issuer module is the default adapter; a real
  async issuer funnels its inbound callback into the same `card.issuer.validation.completed`.
- The synchronous `createTransaction` wrapper (checkout / payment-link) awaits the closing event, so
  those entry points are unchanged.

#### **5.2 `fraud_investigation` — post-auth + case lifecycle**

Begins from `card.payment.authorization.completed` (outcome=authorized). The AML sub-process uses the
payment `correlationId` (`txnId`); the case-lifecycle events use the case reference (`caseRef`) and
cross-link to the transaction in their payload. The case is a long-lived aggregate, so its events are
**discrete facts** (not request/response pairs); the only `*.requested -> *.completed` pair here is
AML monitoring.

| # | eventType | source | correlationId | trigger | persisted |
|---|---|---|---|---|---|
| 1 | `aml.monitoring.requested` | `psp.core` | txnId | on `card.payment.authorization.completed` (authorized) | yes |
| 2 | `aml.monitoring.completed` | `callback.aml` | txnId | AML provider verdict returned (`outcome` in payload) | yes |
| 3 | `fraud.case.opened` | `psp.core` | caseRef | open a case if required and not already open | yes (audit+mirror) |
| 4 | `fraud.case.enriched` | `psp.core` | caseRef | attach correlated subsystem signals to the open case | yes (audit+mirror) |
| 5 | `fraud.question.created` -> `fraud.question.answered` | `psp.core` | caseRef | investigator <-> customer Q&A | yes (audit+mirror) |
| 6 | `fraud.case.updated` | `psp.core` | caseRef | any case status/field change (incl. resolution) | yes (audit+mirror) |

- **One bus, no duplicate signal names.** The case view's live SSE subscribes to these **canonical
  persisted** events by `caseRef` — there are no separate transient `question.*` / `case.updated`
  signals. A single publish both persists the event and wakes the SSE subscriber.
- AML never blocks the (already authorized) payment. A late AML alert triggers `fraud.case.enriched`
  again (and `fraud.case.opened` first if no case exists yet).
- `fraud.case.enriched` always follows `fraud.case.opened`: enrichment adds correlated
  `subsystemSignals` (issuer + FDS + sanctions + AML) to an already-open case, so an investigator
  sees the full picture from one correlated query.

#### **5.3 `card_management`**

`correlationId = card token / customer agreement reference`. All audit+mirror, all persisted.

| eventType | trigger |
|---|---|
| `card.registered` | card added (also auto-registered on first successful pay) |
| `card.accessed` | reveal/detail of a stored card |
| `card.updated` | card metadata change |
| `card.removed` | card deletion |
| `card.shared.threshold.exceeded` | same PAN shared across too many parties (risk signal) |

#### **5.4 `customer_onboarding` (KYC)**

`correlationId = customer/party reference`. Opening + closing process events wrap one KYC provider
pair. (Naming note: `profile.*` is used as proposed; `customer.profile.*` would make the domain
prefix explicit, consistent with `merchant.*` in 5.5.)

| # | eventType | source | persisted |
|---|---|---|---|
| 1 | `profile.validation.requested` | `psp.core` | yes (process opening) |
| 2 | `kyc.validation.requested` | `psp.core` | yes (triggers KYC provider dispatch) |
| 3 | `kyc.validation.completed` | `callback.kyc` | yes (provider verdict; `outcome` in payload) |
| 4 | `profile.validation.completed` | `psp.core` / process | yes (process closing, `outcome` aggregated) |

The HTTP I/O with the KYC provider stays logged in `externalProviderArrangementActionLog`
(`external.kyc.callback` is the wire side of `kyc.validation.completed`).

#### **5.5 `merchant_onboarding` (KYB)**

`correlationId = merchant reference`. Same shape: opening + closing wrap one KYB provider pair.

| # | eventType | source | persisted |
|---|---|---|---|
| 1 | `merchant.validation.requested` | `psp.core` | yes (process opening) |
| 2 | `kyb.validation.requested` | `psp.core` | yes (triggers KYB provider dispatch) |
| 3 | `kyb.validation.completed` | `callback.kyb` | yes (provider verdict; `outcome` in payload) |
| 4 | `merchant.validation.completed` | `psp.core` / process | yes (process closing, `outcome` aggregated) |

The HTTP I/O with the KYB provider stays logged in `externalProviderArrangementActionLog`
(`external.kyb.callback` is the wire side of `kyb.validation.completed`).

#### **5.6 `provider_integration` (operational)**

Connectivity tests and provider inbound dispatch, in `externalProviderArrangementActionLog`
(`triggeredBy`): `system_admin.test`, `manager.run-test.inbound`, `manager.run-test.outbound`,
and the inbound callbacks `external.{fds,aml,kyc,kyb,hrp,card_authorization,card_issuer,generic}.callback`.
The `card_issuer` inbound callback also publishes `card.issuer.validation.completed` (5.1).

#### **5.7 `system` (transient signals)**

| eventType | purpose | persisted |
|---|---|---|
| `party.notification` | bell / sidebar counter SSE | **transient** |

The case view's live updates are **not** transient signals — they ride the canonical persisted
`fraud.*` events (5.2). `transient` is now reserved for ephemeral fan-out like `party.notification`.

---

### **6. Event Standardization — Resolved Standard + Migration Map**

The standard in 5.0 is **agreed**. Renaming an `eventType` is a breaking contract change (subscribers
+ the `domainEvent` store), so this section is the single migration map to apply in one pass.

#### **6.1 Rename map (current -> standard)**

| Current `eventType` | Standard | Notes |
|---|---|---|
| `payment.authorization.requested` | `card.payment.authorization.requested` | process opening event |
| `payment.authorized` + `payment.declined` | `card.payment.authorization.completed` | one closing event; `payload.outcome` = authorized \| declined |
| `transaction.authorized` / `transaction.declined` | *(removed)* | folded into the closing event; still mirrored to the audit ledger |
| `cardissuer.validation.completed` | `card.issuer.validation.completed` | dotted; verdict in payload |
| *(none — was only an action-log dispatch)* | `card.issuer.validation.requested` | new bus event; replaces the `checkout.cvv.validation` trigger name |
| `fraud.scoring.completed` | `fds.scoring.completed` | provider-prefixed |
| *(action-log `fraud.scoring.requested`)* | `fds.scoring.requested` | now a bus event too |
| `sanctions.screening.completed` | `hrp.screening.completed` | provider-prefixed (`hrp`, action = screening) |
| *(action-log `sanctions.screening.requested`)* | `hrp.screening.requested` | now a bus event too |
| `aml.monitoring.completed` | `aml.monitoring.completed` | unchanged (already conformant) |
| *(action-log `aml.monitoring.requested`)* | `aml.monitoring.requested` | now a bus event too |
| `fraud.investigation.case.enriched` | `fraud.case.enriched` | shorter, consistent `fraud.case.*` prefix |
| `question.created` / `question.answered` (transient signal) | *(removed)* | unified into the canonical `fraud.question.created` / `fraud.question.answered` |
| `case.updated` (transient signal) | `fraud.case.updated` | now a canonical persisted event that also drives the case SSE |
| `kyc.profile.updated` | `profile.validation.completed` | folded into the KYC process closing event |
| *(none)* | `profile.validation.requested` / `kyc.validation.requested` / `kyc.validation.completed` | new KYC opening + provider pair on the bus (`external.kyc.callback` is the wire side) |
| `merchant.submitted` | `merchant.validation.requested` | KYB process opening event |
| *(none)* | `kyb.validation.requested` / `kyb.validation.completed` / `merchant.validation.completed` | new KYB provider pair + process closing (`external.kyb.callback` is the wire side) |

The compliance-ledger verdicts `card.issuer.validation.approved|declined` collapse into the single
`card.issuer.validation.completed` with the verdict in payload. The case view's SSE now subscribes to
the canonical `fraud.*` events (by `caseRef`) instead of separate transient signals.

#### **6.2 Rules locked by this standard**

1. **One opening + one closing event per business process.** The closing `*.completed` fires only
   when every dependent provider `*.completed` has arrived; `payload.outcome` carries the result.
2. **No success/failure event names** — outcome lives in the `.completed` payload.
3. **Every provider call is a `*.requested -> *.completed` pair on the bus** (the HTTP dispatch is
   the wire side, logged in the action log). This closes the trail gap (request->response pairs).
4. **`causationId` is mandatory** along the chain (see 5.0) so a journey graph is fully traceable.

#### **6.3 Resolved: `businessProcess` across one `correlationId`**

**Decision:** post-auth `aml.monitoring.*` and case enrichment keep `businessProcess:
fraud_investigation`, even though they share the payment's `correlationId`. Rationale: post-auth *is*
investigation, so the `byProcess` split is meaningful — `byProcess('card_payment')` returns the
Phase-1 authorization, `byProcess('fraud_investigation')` returns the post-auth monitoring + case.
The trail by `correlationId` remains the single end-to-end journey regardless.

> Recommendation: adopt items 1-2 (pure naming, low risk via a one-pass rename + store note), decide
> 3-4 together (they deliver the "relationship between events" requirement for investigation/audit),
> and explicitly resolve 5 so `byProcess` reporting is unambiguous. No code changes until these are
> validated.

