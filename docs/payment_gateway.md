# PCI DSS Aligned Card Payment Gateway Blueprint
## 1. Purpose and scope
### 1.1 Objective

- Define the engineering and security blueprint for building a payment gateway that supports card payments and is designed to operate in alignment with PCI DSS (Payment Card Industry Data Security Standard) requirements.
- Position the system as a PCI DSS aligned architecture and implementation guide, not as an automatic compliance claim. MongoDB Atlas is a PCI DSS validated service provider, but the customer remains responsible for their own PCI DSS program, deployment controls, and assessor validation.
### 1.2 In scope

- Card-not-present payment acceptance
- Authorization flow
- Tokenization and vaulting strategy
- Merchant API (Application Programming Interface) design
- Gateway orchestration and routing
- PCI cardholder data environment design
- Key management and cryptographic controls
- Identity, access, auditing, logging, monitoring, and operational controls
- High availability, resilience, and incident response
- MongoDB data model and platform controls for PCI aligned workloads
### 1.3 Out of scope

- Bank transfer rails such as SEPA (Single Euro Payments Area), ACH (Automated Clearing House), SWIFT (Society for Worldwide Interbank Financial Telecommunication), and PIX (Brazilian instant payment system)
- Full issuer processing platform
- Full acquiring bank core systems
- Card scheme certification program details
- Jurisdiction-specific legal advice
## 2. Executive summary

- A payment gateway securely captures payment requests, validates and routes them, and returns authorization outcomes to the merchant application.
- A complete card payment flow normally involves merchant application, payment gateway, payment processor, acquiring bank, card network, and issuing bank.
- PCI DSS applies to entities that store, process, or transmit cardholder data and provides baseline technical and operational requirements to protect payment account data.
- The architecture should minimize PCI scope, minimize plaintext exposure, never retain prohibited sensitive authentication data after authorization, and enforce least privilege, auditability, and strong cryptography.
## 3. Business and compliance context
### 3.1 Why this system exists

- Accept card payments securely at scale
- Reduce fraud and operational risk
- Support dispute, exception, and investigation workflows
- Provide traceability for auditors, security teams, and operations teams
### 3.2 PCI DSS context

- PCI DSS applies to all entities that store, process, or transmit cardholder data.
- Cardholder Data Environment (CDE) includes systems that store, process, or transmit cardholder data, plus systems directly connected to or supporting that environment.
- The design should explicitly separate PCI-scoped services, networks, data stores, and operator paths from non-PCI workloads.
### 3.3 Shared responsibility statement

- Platform providers secure the underlying managed platform.
- Customers remain responsible for application design, access control, data policies, key management decisions, deployment configuration, and compliance validation.
## 4. Payment domain model and actors
### 4.1 Core actors

- Cardholder
- Merchant
- Merchant backend
- Payment gateway
- Payment processor
- Acquirer
- Acquiring bank
- Card network
- Issuer
- Issuing bank
- Fraud service
- Token service / vault
- KMS (Key Management Service) / HSM (Hardware Security Module)
- Security operations / auditor
- Settlement and reconciliation service
- Dispute / chargeback operations
### 4.1.1 Payment gateway vs payment processor

- Payment gateway: the merchant-facing component that securely captures, validates, tokenizes when needed, and routes payment requests.
- Payment processor: the downstream transaction-processing component that connects the merchant side to the acquiring side, processes the transaction flow, and usually participates in clearing and settlement operations.
- They are related but not always identical components.
- In some providers both capabilities are bundled into a single platform, but architecturally it is better to distinguish them because they serve different roles.
### 4.1.2 Role of each component

- **Cardholder:** initiates the purchase and provides the payment credential.
- **Merchant:** sells the good or service and initiates the payment request from its commerce channel.
- **Merchant backend:** creates the payment intent, applies business rules, and calls the payment gateway.
- **Payment gateway:** receives the payment request, validates format and policy, applies security controls, tokenizes or retrieves token references, and routes the request to the appropriate downstream processor or acquirer path.
- **Payment processor:** executes the payment processing path, transforms or relays payment messages to the acquiring side, and supports transaction execution, clearing, and operational settlement functions.
- **Acquirer:** the merchant-side acquiring entity or acquiring platform connected to the card schemes and responsible for merchant acceptance.
- **Acquiring bank:** the bank that provides merchant acquiring services, receives the authorized transaction from the network side, and later settles funds to the merchant account.
- **Card network:** the scheme layer, such as Visa or Mastercard, that routes authorization, clearing, and settlement messages between acquiring and issuing sides.
- **Issuer:** the card issuing entity that evaluates the transaction request, applies balance, credit, fraud, and authorization rules, and approves or declines the transaction.
- **Issuing bank:** the bank that issued the card to the customer and ultimately authorizes or declines the use of funds or credit.
- **Fraud service:** evaluates risk signals before or during authorization and may trigger step-up controls or rejection.
- **Token service / vault:** replaces sensitive card data with tokens and controls detokenization under tightly restricted conditions.
- **KMS / HSM:** manages cryptographic keys and protects key operations used for encryption, tokenization support, or signing.
- **Settlement and reconciliation service:** reconciles gateway, processor, acquirer, and merchant records and supports financial close-out and exception handling.
- **Dispute / chargeback operations:** manages representment, evidence, chargeback workflows, and post-transaction investigation.
- **Security operations / auditor:** monitors logs, reviews privileged access, investigates incidents, and validates control effectiveness.
### 4.2 Core payment objects

- Payment intent
    - BIAN (Banking Industry Architecture Network) alignment note: this can be aligned to a BIAN-style service landscape as the business object used by the payment initiation and orchestration flow, with adjacent service domains covering customer authentication, fraud screening, payment execution, settlement, dispute handling, and case management.
- Authorization request
- Authorization response
- Merchant order
- Customer reference
- Tokenized card instrument
- Settlement record
- Refund
- Chargeback / dispute
- Case / investigation record
## 5. High-level card payment flow
### 5.1 Authorization flow

1. Merchant collects card details or redirects to a PCI-capable hosted payment component.
2. Payment data is transmitted over TLS (Transport Layer Security) to the payment gateway or hosted payment endpoint.
3. Gateway validates message structure, merchant identity, risk checks, and policy.
4. Gateway tokenizes or retrieves tokenized instrument references.
5. Gateway routes request to processor / acquirer.
6. Request is converted into payment-network-compatible message formats where needed, such as ISO 8583 (International Organization for Standardization 8583 card payment messaging standard) in card-processing paths.
7. Acquirer and card network forward to issuer for authorization.
8. Response returns through the same chain to the merchant.
9. Audit trail, fraud outcomes, and operational telemetry are recorded.
### 5.2 Optional flows

- 3DS (Three-Domain Secure) challenge flow for stronger customer authentication
- Partial capture
- Void
- Refund
- Retry and idempotent replay
- Chargeback and dispute evidence flow
### 5.3 Simplified component relationship and bank role

- The merchant backend creates the payment intent and sends the payment request to the payment gateway.
- The payment gateway validates, secures, and routes the request to the payment processor or acquiring path.
- The payment processor handles transaction processing and passes the authorization request toward the acquirer or acquiring bank.
- The acquiring bank represents the merchant side in the card ecosystem and forwards the transaction into the card network.
- The card network routes the authorization message to the issuing bank.
- The issuing bank is the customer bank that evaluates available funds or credit, fraud controls, and card status, then approves or declines the transaction.
- The approval or decline returns from the issuing bank through the card network, acquiring bank, payment processor, and payment gateway back to the merchant.
- After authorization, clearing and settlement continue between the issuing side and acquiring side, while the acquiring bank ultimately settles funds to the merchant account according to its merchant agreement.
- The payment gateway, processor, merchant, and reconciliation services must all preserve auditability, exception handling, and dispute traceability across the full lifecycle.
### 5.4 Simple text diagram in Markdown

```text
Cardholder
  |
  v
Merchant front end
  |
  v
Merchant backend
  |
  v
Payment gateway
  |
  v
Payment processor
  |
  v
Acquirer / Acquiring bank
  |
  v
Card network
  |
  v
Issuer / Issuing bank
  |
  +-- Approve or decline authorization
  |
  v
Card network
  |
  v
Acquirer / Acquiring bank
  |
  v
Payment processor
  |
  v
Payment gateway
  |
  v
Merchant backend
  |
  v
Merchant front end
```
### 5.5 Bank role by stage

- Payment initiation stage: the bank is not yet deciding the transaction, but the merchant side may already be using acquiring-bank rules, merchant configuration, and fraud controls.
- Authorization stage: the issuing bank plays the decisive role by approving or declining the transaction, while the acquiring bank represents the merchant side and forwards the request into the network.
- Clearing stage: network, processor, and banking participants exchange the financial records needed to formalize the transaction.
- Settlement stage: the acquiring bank receives funds through the card ecosystem and settles them to the merchant account, net of applicable fees and timing rules.
- Dispute stage: both issuing and acquiring sides can participate, depending on chargeback, representment, evidence, and scheme rules.
## 6. Reference architecture
### 6.1 External-facing edge

- DNS (Domain Name System) and global traffic management
- CDN (Content Delivery Network) only for non-sensitive assets
- WAF (Web Application Firewall)
- API gateway
- Bot protection and rate limiting
- DDoS (Distributed Denial of Service) controls
### 6.2 Core services

- Merchant authentication service
- Payment API service
- Tokenization service
- Routing and orchestration engine
- Risk and fraud decisioning service
- 3DS service integration
- Ledger / transaction event service
- Reconciliation service
- Dispute / investigation service
- Notification service
### 6.3 Data and security services

- Encrypted operational data store
- Token vault
- KMS / HSM integration
- Secrets management
- Central audit pipeline
- SIEM (Security Information and Event Management) integration
- Metrics and tracing pipeline
### 6.4 Administrative and management plane

- Separate administrative access path
- Separate operator identities
- Privileged access workflow
- Controlled break-glass procedure
- Change management and approval records
## 7. PCI DSS scoping and segmentation strategy
### 7.1 Scope reduction principles

- Keep PAN (Primary Account Number) handling isolated to the smallest possible set of services.
- Use hosted payment fields or hosted payment pages where practical.
- Replace PAN with tokens as early as possible.
- Keep non-PCI systems outside the CDE through segmentation and clean interfaces.
### 7.2 Network segmentation

- Separate PCI CDE VPC (Virtual Private Cloud) / VNet (Virtual Network) / project
- Separate subnets for edge, app, data, and management
- Private connectivity between services
- No broad east-west trust
- Explicit firewall policy by service identity and port
### 7.3 Trust boundaries

- Internet to edge
- Edge to PCI application services
- PCI services to token vault
- PCI services to processor / acquirer connectors
- PCI services to data platform
- PCI services to logging and SIEM
- Management plane isolated from business workflow
## 8. Data classification and retention rules
### 8.1 Data categories

- Cardholder Data (CHD)
- Sensitive Authentication Data (SAD)
- PII (Personally Identifiable Information)
- Merchant operational data
- Security telemetry
- Case and dispute evidence
### 8.2 Data handling rules

- Never store CVV (Card Verification Value), PIN (Personal Identification Number), or other prohibited sensitive authentication data after authorization.
- Avoid storing full PAN unless there is a justified business and compliance requirement.
- Prefer network tokens or processor tokens for downstream operations.
- Store masked PAN only where strictly required for business display and support.
- Retain only the minimum data needed for business, legal, reconciliation, and fraud workflows.
## 9. Encryption and key management architecture
### 9.1 Data in transit

- TLS 1.2 or higher for all client and service traffic
- Mutual TLS for internal service-to-service paths where justified
- Strong cipher policy and certificate lifecycle automation
### 9.2 Data at rest

- Encrypted volumes and backup media
- Separate storage domains for PCI and non-PCI data
- Encrypted backups with retention controls
### 9.3 Data in use

- Encrypt sensitive fields before they reach the database when appropriate.
- MongoDB guidance supports client-side protection of sensitive fields together with encrypted query workflows for selected use cases.
### 9.4 Key management

- Customer-controlled KMS path where required
- Separate data encryption keys for different protected datasets
- Key rotation policy
- Key destruction and incident procedures
- Strict split between infrastructure administration and business-data decryption paths
## 10. MongoDB data architecture for PCI aligned workloads
### 10.1 Design goal

- Support operational payment workflows while reducing plaintext exposure and enforcing field-level protection.
### 10.2 Recommended collection boundaries

- `payment_lookup_qe` or equivalent searchable payment collection
- `payment_sensitive_qe` or Client-Side Field Level Encryption (CSFLE) protected equivalent for retained, non-searchable sensitive fields
- `customer_lookup_qe` where customer search is required
- `customer_sensitive_qe` or CSFLE protected equivalent for highly sensitive retained data
- `investigation_case`
- `audit_event`
- `token_reference`
### 10.3 Critical product constraint

- Queryable Encryption (QE) and CSFLE must not be used on the same collection. If both are used in one application, they must be separated by collection boundary.
### 10.4 Preferred first implementation pattern

- Use QE for fields that need encrypted lookup.
- Use QE with query type none, or separate non-searchable protected collections, for retained sensitive values where search is not required.
- Keep the first version narrow and security-first.
### 10.5 Suggested protected fields

- Searchable: payment_reference, account_reference, merchant_reference, customer_email, customer_phone, card_token
- Retrieval only: full_address, government_id, internal_risk_notes, raw_gateway_payload, sensitive_processor_metadata
- Not for routine storage in v1: full PAN
- Never retain after authorization: CVV, PIN, SAD
## 11. Application and API design
### 11.1 External APIs

- Create payment
- Confirm payment
- Capture authorization
- Void authorization
- Refund payment
- Retrieve payment status
- Tokenize card
- Retrieve token metadata
- Webhook registration and delivery
- Dispute submission
### 11.2 API control requirements

- Strong merchant authentication
- Idempotency keys on write operations
- Replay protection
- Message signing for callbacks
- Per-merchant authorization boundaries
- Rate limits and anomaly detection
- Versioned schemas and backward compatibility
### 11.3 Hosted payment option

- Include a hosted payment field / hosted payment page model for merchants that should avoid direct card data handling.
- Clarify which integration patterns keep merchants out of full PAN handling paths.
## 12. Identity, access, and privileged operations
### 12.1 Personas

- Ingestion service
- Payment orchestration service
- Level 1 support analyst
- Level 2 investigator
- Security auditor
- Platform operator
- Break-glass administrator
### 12.2 Control principles

- Least privilege
- Role-based access control (RBAC)
- MFA (Multi-Factor Authentication) for privileged paths
- Federated identity where supported
- No shared admin identities
- Short-lived credentials
- Just-in-time privileged access
### 12.3 Access stages

- Level 1 operational search on limited, approved fields
- Level 2 escalation with additional protected data access through explicit workflow and audit trail
## 13. Audit, logging, and SIEM integration
### 13.1 Audit objectives

- Prove who accessed what, when, why, and under which role
- Detect unauthorized use, privilege escalation, or policy drift
- Support dispute and forensic workflows
### 13.2 Minimum event set

- Authentication success and failure
- Role and privilege changes
- Schema and collection changes
- Access to PCI-relevant data collections
- Investigation case actions
- Escalation and reveal actions
- Management-plane administrative events
### 13.3 Event flow

- MongoDB auditing and application audit events emitted
- Forward to SIEM
- Correlate business events, analyst activity, and privileged actions
- Preserve references back to investigation cases
## 14. Fraud, risk, and authentication controls
### 14.1 Fraud controls

- Velocity rules
- Device and IP risk
- Behavioral heuristics
- Merchant risk profiles
- Geolocation anomalies
- BIN (Bank Identification Number) intelligence
- Sanctions / watchlist controls where applicable
### 14.2 Customer authentication controls

- 3DS support for applicable transactions
- Step-up challenge routing
- Strong customer authentication integration where required by market
## 15. High availability, resilience, and disaster recovery
### 15.1 Availability goals

- Active-active edge
- Multi-AZ (Multiple Availability Zone) / multi-region design for critical services
- Graceful degradation for non-critical services
- Queue-based decoupling for downstream dependencies
### 15.2 Data resilience

- Backups
- Point-in-time recovery
- Cross-region copies
- Restore testing
- Immutable backup policy where required
### 15.3 MongoDB platform capabilities to map

- Auditing
- Private connectivity
- Encryption at rest
- Continuous backup
- Multi-region or multi-cloud topology depending on design choice
## 16. Operational security and SDLC
### 16.1 Secure software delivery

- Threat modeling
- Secure coding standards
- Secrets scanning
- Dependency scanning
- Container hardening
- SAST (Static Application Security Testing) / DAST (Dynamic Application Security Testing) / IaC (Infrastructure as Code) scanning
- Segregation of duties for deployment
### 16.2 Change and release management

- Change approval for PCI-scoped services
- Controlled rollback
- Emergency release process
- Release evidence archive
### 16.3 Vulnerability and patch management

- Service level agreement by severity
- Asset inventory
- Patch validation
- Compensating control process
## 17. Compliance evidence and control mapping
### 17.1 Evidence categories

- Architecture diagrams
- Data flow diagrams
- Asset inventory
- Access control matrix
- Key management records
- Audit log samples
- Penetration test records
- Secure software development life cycle evidence
- Backup and restore test records
- Incident response exercises
### 17.2 Responsibility matrix

- Control owner
- Service owner
- Platform owner
- Security owner
- Compliance owner
- Shared-responsibility note for managed services
## 18. Implementation roadmap
### 18.1 Phase 1

- Hosted payment integration
- Tokenization
- Authorization-only flow
- Minimal PCI-scoped data stores
- Core audit trail
- Basic reconciliation
### 18.2 Phase 2

- Capture, void, refund
- Multi-processor routing
- 3DS integration
- Role-based operations console
- SIEM integration
- Backup and disaster recovery validation
### 18.3 Phase 3

- Chargeback handling
- Advanced fraud models
- Multi-region active-active patterns
- Compliance automation and evidence collection
- Fine-grained operational analytics
## 19. Risks and design decisions
### 19.1 Architectural decisions to lock early

- Redirect / hosted fields vs direct card capture
- Token vault ownership model
- Processor and acquirer integration model
- Multi-region strategy
- Key ownership model
- Level of PAN retention, if any
- QE-only baseline vs mixed-by-collection encryption model
### 19.2 Common failure modes

- Expanding PCI scope unintentionally
- Logging sensitive data
- Over-broad support access
- Mixing searchable and non-searchable encryption patterns incorrectly
- Weak segmentation between PCI and non-PCI services
- Incomplete audit coverage
- Treating platform PCI validation as full application compliance
## 20. Appendices to produce in the full document

- Detailed card payment sequence diagram
- CDE network segmentation diagram
- Data classification matrix
- MongoDB collection and field protection matrix
- RBAC matrix by persona
- Audit event catalog
- Key management lifecycle diagram
- Backup and recovery runbook
- Incident response runbook
- PCI DSS control mapping table
- Merchant integration patterns comparison
- Build checklist for engineering handoff
## 21. Key document principles

- Keep the narrative security-first and implementation-oriented.
- Use synthetic data for any demo or example payloads rather than real cardholder data.
- Present MongoDB as a platform component that can support PCI DSS aligned architectures, while stating clearly that compliance remains the customer’s responsibility.

