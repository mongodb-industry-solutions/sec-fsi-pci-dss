# Integration Hub Enhancement Proposal
## Configurable Field Mapping · Multi-Provider Routing · Category-Specific Configuration

**Status:** Proposal  
**Version:** 1.0  
**Author:** Antonio Membrides Espinosa  
**Date:** 2026-06-10  
**Related ADRs:** ADR-013 · ADR-014 · ADR-015 · ADR-016 · ADR-017  
**Depends on:** ADR-010, ADR-011, ADR-012 (v6 Integration Hub baseline)

---

## 1. Executive Summary

The current Integration Hub (SD-193, v6) supports registering one external provider per compliance category with a fixed payload contract. This proposal extends it with five capabilities that address real-world integration friction:

| # | Capability | Problem it solves |
|---|---|---|
| 1 | **Configurable Field Mapping** | External systems use different field names; adapters require code deployment |
| 2 | **Structured Authentication Config** | Auth credentials (OAuth2, HMAC, API key location) need UI-managed configuration |
| 3 | **Category-Specific Configuration** | Each of the 6 compliance domains has unique operational parameters |
| 4 | **Multi-Provider Routing** | Organizations use 2+ providers of the same type (fallback, regional, parallel) |
| 5 | **Generic Integration Category** | Events that don't map to the 6 predefined domains need a catch-all |

All five capabilities are designed to be **100% BIAN SD-193 compatible** and **PCI DSS v4.0 compliant**. No cardholder data traverses the mapping layer. No new collections exceed the compliance scope already established in ADR-012.

---

## 2. Current State and Gaps

### What works today (v6 baseline)

- Six integration categories, each mapped to a BIAN SD and PCI DSS requirements
- Single active provider per category (internal or external)
- API key hashing, HMAC callback validation, 90-day event audit TTL
- Health monitoring, connectivity testing, key rotation
- RBAC-enforced admin UI (system_admin role only)

### Identified gaps

**Gap 1 — Fixed payload contract**  
The dispatch service sends internal field names directly to the external endpoint. If a legacy fraud detection system expects `risk_level` instead of `fraudScore`, the integration fails silently or requires a code-level adapter. There is no UI-based way to configure field name translation.

**Gap 2 — Auth credentials not configurable at runtime**  
The admin can register a new provider with a type (bearer/api_key/hmac/oauth2_cc) but cannot configure WHERE the API key goes (which header, query param, or body field), cannot configure OAuth2 token endpoint/scopes, and cannot configure outbound HMAC parameters. These are hardcoded.

**Gap 3 — No category-specific operational parameters**  
A KYC provider has verification levels, document types, and re-verification periods. An AML provider has screening lists, jurisdictions, and SAR thresholds. The current schema has no place for these — all categories share the same flat configuration.

**Gap 4 — Single active provider per type**  
`getActiveProviderForType()` returns exactly one provider. An organization running two fraud detection engines (one real-time, one ML batch) cannot configure both. There is no fallback, no load balancing, and no parallel enrichment.

**Gap 5 — No generic integration type**  
Some business events (contract signing, notification dispatch, document archival) require external calls but don't belong to the 6 compliance domains. Today they must be hardcoded outside the registry.

---

## 3. Proposed Architecture

### 3.1 System Overview

```
Admin Panel (system_admin)
    │
    ├─ Integration List (enhanced: shows group size, routing strategy)
    ├─ Integration Detail (enhanced: 6 tabs)
    │       ├─ Tab 1: Overview (existing)
    │       ├─ Tab 2: Authentication Config (NEW)
    │       ├─ Tab 3: Field Mapping (NEW)
    │       ├─ Tab 4: Category Config (NEW)
    │       ├─ Tab 5: Provider Routing (NEW, multi-provider groups)
    │       └─ Tab 6: Events (existing)
    └─ Registration Wizard (enhanced: 5 steps)
            ├─ Step 1: Basic info (name, type, mode)
            ├─ Step 2: Authentication
            ├─ Step 3: Category Configuration
            ├─ Step 4: Field Mapping (optional)
            └─ Step 5: Review + Submit

Dispatch Service (enhanced)
    │
    ├─ Resolve provider (single → group routing strategy aware)
    ├─ Apply outbound field mapping (fieldMappingConfig.outbound)
    ├─ Build auth headers (authConfig by scheme type)
    ├─ Send HTTP request
    └─ Log event (mapping stats included)

Callback Service (enhanced)
    │
    ├─ Validate HMAC (signature header from authConfig.inboundWebhook)
    ├─ Apply inbound field mapping (fieldMappingConfig.inbound)
    └─ Route to domain handler (unchanged)
```

### 3.2 Field Mapping Engine

The field mapping engine is a **pure data transformation layer** — it never touches cardholder data, encryption keys, or PCI DSS in-scope fields (see §7 for PCI DSS analysis).

**Supported transformation types:**

| Transform type | Description | Example |
|---|---|---|
| `rename` | Change field name only, preserve value | `fraudScore` → `risk_level` |
| `value_map` | Map discrete values | `"HIGH"` → `"high_risk"` |
| `scale` | Multiply by a factor | `0.85` × 100 → `85` |
| `date_format` | Convert date representations | ISO 8601 → Unix timestamp |
| `nested_extract` | Unwrap from nested path | `result.data.score` → `score` |
| `nested_wrap` | Wrap into a nested path | `score` → `result.data.score` |
| `stringify` | JSON serialize a value | `{...}` → `"{"...}"` |
| `parse_json` | JSON deserialize a string | `"{"...}"` → `{...}` |
| `constant_inject` | Add a static field (outbound only) | add `source: "leafybank"` |
| `drop` | Remove a field from the payload | remove `internalCaseRef` |

**Mapping direction:**

- **Outbound**: Applied before the HTTP request is sent. Translates internal field names/values to what the external system expects.
- **Inbound**: Applied to the external response (sync) or webhook body (async) before it reaches the domain handler. Translates external field names/values to what the internal handler expects.

**Security constraint**: The mapping engine has an explicit blocklist of fields that cannot be remapped or injected:
```
PAN, CVV, expiryDate, cardholderName, externalProviderApiKeyHash,
externalProviderCallbackSecretHash, jwtSecret
```
Any mapping rule targeting these fields is rejected at configuration save time (backend validation).

### 3.3 Multi-Provider Routing

Multiple `ExternalProviderArrangement` records can belong to the same **routing group**. The group defines the strategy for selecting a provider at dispatch time.

**Routing strategies:**

| Strategy | Description | Use case |
|---|---|---|
| `primary_fallback` | Try primary first; if it fails (timeout, error), try fallback | HA for critical KYC/AML path |
| `round_robin` | Distribute requests evenly across all active members | Load balancing (equal providers) |
| `weighted` | Distribute by weight (0-100 per member, must sum to 100) | A/B testing, gradual migration |
| `parallel` | Dispatch to all members simultaneously; aggregate results | Consensus fraud scoring |

**Parallel aggregation modes** (for `parallel` strategy):
- `first_success`: Return first non-error response; cancel remaining
- `all`: Wait for all responses; return array of results to domain handler
- `majority_vote`: For boolean results (verified/rejected); return the majority outcome

**PCI DSS note**: Each member of a routing group is a separate `ExternalProviderArrangement` record with its own compliance tracking (health checks, key rotation, event log). Req 12.8.1 is satisfied because all providers are listed individually.

### 3.4 Category-Specific Configuration

Each integration type exposes a typed `categoryConfig` sub-document. The UI renders a different form per type. The backend validates the config shape against the type.

#### fraud_detection — FraudDetectionConfig

```typescript
interface FraudDetectionConfig {
  scoreThresholds: {
    low: number          // 0-100: below this = low risk
    medium: number       // 0-100: below this = medium risk (above = high)
  }
  scoreField: string               // field name in response that carries the score
  recommendationField: string      // field name for accept/review/reject recommendation
  realTimeRequired: boolean        // false = batch OK
  batchSupported: boolean
  modelVersion?: string            // track which ML model version
  scoreScaleMax: number            // 100 or 1.0 — for UI display normalization
}
```

**BIAN alignment**: SD-63 Fraud Evaluation BQ:FraudEvaluationAssessment — `scoreThresholds` maps to `FraudEvaluationAssessmentPreconditions`.

#### aml_monitoring — AmlMonitoringConfig

```typescript
interface AmlMonitoringConfig {
  screeningTypes: ('customer_onboarding' | 'transaction' | 'batch_periodic')[]
  watchlistSources: ('OFAC_SDN' | 'EU_Consolidated' | 'UN_Consolidated' | 'FATF' | 'UK_HMT' | 'custom')[]
  customWatchlistUrl?: string
  jurisdictions: string[]           // ISO 3166-1 alpha-2 codes
  sarThreshold?: number             // Amount above which SAR filing is triggered
  sarCurrency?: string              // ISO 4217
  continuousMonitoring: boolean
  batchSchedule?: string            // cron expression for periodic screening
  alertSeverityLevels: ('low' | 'medium' | 'high' | 'critical')[]
}
```

**PCI DSS alignment**: AML events are audit-logged (Req 10.2.1). SAR thresholds are stored but not processed in the demo (reference architecture only).

#### kyc_identity — KycIdentityConfig

```typescript
interface KycIdentityConfig {
  verificationLevels: ('basic' | 'enhanced' | 'full')[]
  defaultLevel: 'basic' | 'enhanced' | 'full'
  documentTypesAccepted: ('passport' | 'national_id' | 'drivers_license' | 'residence_permit')[]
  livenessCheckRequired: boolean
  biometricSupported: boolean
  reVerificationDays: number         // Days before KYC record expires
  dataRetentionDays: number          // PCI DSS-aligned retention period
  consentRequired: boolean
}
```

**PCI DSS alignment**: Req 8.1 (identify and authenticate users). `dataRetentionDays` documents the retention policy per Req 12.3.

#### kyb_business — KybBusinessConfig

```typescript
interface KybBusinessConfig {
  uboDisclosureThreshold: number       // % ownership (typically 25)
  businessTypesSupported: ('llc' | 'corporation' | 'partnership' | 'sole_proprietor' | 'trust' | 'ngo')[]
  registrationCountries: string[]      // ISO 3166-1 alpha-2
  dueDiligenceLevel: 'standard' | 'enhanced' | 'extreme'
  renewalDays: number                   // Days before KYB record requires renewal
  pepScreeningIncluded: boolean         // Politically Exposed Persons
  adverseMediaScreening: boolean
}
```

**BIAN alignment**: SD-89 Merchant Relations BQ:MerchantAgreementKybCheck. `uboDisclosureThreshold` aligns with FATF Recommendation 24.

#### hrp_sanctions — HrpSanctionsConfig

```typescript
interface HrpSanctionsConfig {
  screeningLists: ('OFAC_SDN' | 'EU_Consolidated' | 'UN_Consolidated' | 'UK_HMT' | 'PEP_Global' | 'custom')[]
  customListUrl?: string
  matchThreshold: number               // 0-100: fuzzy match sensitivity
  screeningDimensions: ('name' | 'dob' | 'nationality' | 'address' | 'id_number')[]
  realTimeScreening: boolean
  batchRescreeningSchedule?: string    // cron for periodic re-screening
  hitDispositionRequired: boolean      // Must a human review every hit?
  autoApproveBelow?: number            // Auto-pass below this fuzzy match score
}
```

**BIAN alignment**: SD-13 Party Reference Data. `matchThreshold` is the configurable equivalent of `PartyReferenceDataDirectoryEntry.partyMatchQualityThreshold`.

#### credit_bureau — CreditBureauConfig

```typescript
interface CreditBureauConfig {
  bureauName: string                   // "Equifax", "Experian", "TransUnion", "custom"
  bureauRegion: string                 // ISO 3166-1 alpha-2 country or region
  pullTypes: ('soft' | 'hard')[]
  defaultPullType: 'soft' | 'hard'
  scoringModel?: string                // "FICO8", "VantageScore3", "custom"
  scoreRangeMin: number                // e.g., 300
  scoreRangeMax: number                // e.g., 850
  consentRequired: boolean
  consentDocumentRef?: string          // Reference to consent form template
  refreshFrequencyDays: number         // How often to refresh credit data
  jurisdictions: string[]
}
```

**PCI DSS alignment**: Req 12.8.1 (listed as TPSP). `consentRequired` supports Req 3 (data minimization) by ensuring credit pulls have legal basis.

#### generic — GenericIntegrationConfig

```typescript
interface GenericIntegrationConfig {
  categoryLabel: string                // User-defined label (e.g., "Document Archival")
  customEventTypes: string[]           // Events this integration handles (e.g., ["contract.signed"])
  description?: string
  tags?: string[]
  customFieldSchema?: object           // JSON Schema for payload validation (optional)
}
```

**BIAN alignment**: SD-193 allows for generic External Provider Arrangements not tied to a specific service domain. `bianServiceDomain` should be set to "External Provider Arrangements" for generic type.

### 3.5 Structured Authentication Configuration

The current `externalProviderAuthScheme` enum is extended with a typed `authConfig` sub-document that provides all parameters needed to build auth headers at dispatch time.

**Security model**: Auth credentials are stored **encrypted** using MongoDB Queryable Encryption (QE) equality fields with a dedicated `integrationCredentialsDEK`. This is a new DEK added to the QE key management hierarchy (see §6 for QE changes). The plaintext is only accessible server-side via the QE driver — never returned in API responses.

```typescript
interface IntegrationAuthConfig {
  scheme: IntegrationAuth

  // Bearer Token
  bearer?: {
    tokenHeaderName: string          // Default: "Authorization"
    tokenPrefix: string              // Default: "Bearer"
    tokenExpiresAt?: string          // ISO 8601 — for rotation reminder
    // Actual token stored as QE-encrypted field (separate: authTokenEncrypted)
  }

  // API Key
  apiKey?: {
    keyHeaderName: string            // e.g., "X-API-Key", "Authorization"
    keyLocation: 'header' | 'query' | 'body'
    keyParamName?: string            // For query/body: the parameter name
    keyPrefix?: string               // e.g., "ApiKey " (with trailing space)
    // Actual key stored as QE-encrypted field (separate: authApiKeyEncrypted)
  }

  // HMAC (outbound — we sign our requests)
  hmacOutbound?: {
    algorithm: 'sha256' | 'sha512'
    signatureHeaderName: string      // e.g., "X-Signature"
    signaturePrefix: string          // e.g., "sha256="
    payloadFormat: 'hex' | 'base64'
    includeTimestamp: boolean        // Add timestamp to prevent replay
    timestampHeaderName?: string     // e.g., "X-Timestamp"
    // Actual secret stored as QE-encrypted field (separate: authHmacSecretEncrypted)
  }

  // HMAC (inbound webhook validation — they sign their responses to us)
  hmacInbound?: {
    algorithm: 'sha256' | 'sha512'
    signatureHeaderName: string      // e.g., "X-Webhook-Signature"
    signaturePrefix: string          // e.g., "sha256="
    payloadFormat: 'hex' | 'base64'
    replayWindowSeconds: number      // Reject requests older than N seconds
    // Actual secret stored as QE-encrypted field (separate: callbackHmacSecretEncrypted)
  }

  // OAuth2 Client Credentials
  oauth2?: {
    clientId: string                 // Not secret — can be plaintext
    tokenEndpoint: string
    scopes: string[]
    tokenCachingEnabled: boolean
    tokenCacheTtlSeconds?: number    // How long to cache tokens (default: from expiry)
    // Client secret stored as QE-encrypted field (separate: authOauth2SecretEncrypted)
  }
}
```

**QE-encrypted credential fields** (added to `integrationRegistry` encrypted fields map):
```
authTokenEncrypted          — bearer token value (QE equality)
authApiKeyEncrypted         — API key value (QE equality)  
authHmacSecretEncrypted     — outbound HMAC signing secret (QE equality)
callbackHmacSecretEncrypted — inbound HMAC validation secret (QE equality)
authOauth2SecretEncrypted   — OAuth2 client secret (QE equality)
```

These replace the existing `externalProviderApiKeyHash` and `externalProviderCallbackSecretHash` bcrypt fields, which are retained for backward compatibility during migration.

---

## 4. Data Model Changes

### 4.1 Updated `ExternalProviderArrangement`

```typescript
// Additions to the existing interface (no removals for backward compatibility)
interface ExternalProviderArrangement {
  // ... all existing fields unchanged ...

  // NEW: Category-specific operational configuration
  categoryConfig?: FraudDetectionConfig
    | AmlMonitoringConfig
    | KycIdentityConfig
    | KybBusinessConfig
    | HrpSanctionsConfig
    | CreditBureauConfig
    | GenericIntegrationConfig

  // NEW: Structured authentication parameters
  authConfig?: IntegrationAuthConfig

  // NEW: Field mapping configuration
  fieldMappingConfig?: FieldMappingConfig

  // NEW: Multi-provider routing group membership
  routingGroupId?: string              // FK → integrationRoutingGroups
  routingPriority?: number             // Lower = higher priority (default: 100)
  routingWeight?: number               // 0-100 for weighted strategy

  // UPDATED: provider type now includes 'generic'
  externalProviderArrangementType: IntegrationProviderType  // adds 'generic'

  // QE-encrypted credential fields (new, replaces hash-based storage for external creds)
  authTokenEncrypted?: string          // QE encrypted
  authApiKeyEncrypted?: string         // QE encrypted
  authHmacSecretEncrypted?: string     // QE encrypted
  callbackHmacSecretEncrypted?: string // QE encrypted (replaces callbackSecretHash)
  authOauth2SecretEncrypted?: string   // QE encrypted
}
```

### 4.2 New Type Definitions

```typescript
// Field mapping system
export interface FieldMapping {
  sourcePath: string               // Dot-notation path (e.g., "result.score")
  targetPath: string               // Dot-notation path (e.g., "fraudScore")
  transform?: FieldTransform
  required: boolean
  defaultValue?: unknown           // Used if source field is missing
}

export interface FieldTransform {
  type: 'rename' | 'value_map' | 'scale' | 'date_format'
      | 'nested_extract' | 'nested_wrap' | 'stringify'
      | 'parse_json' | 'constant_inject' | 'drop'
  scaleFactor?: number             // For 'scale'
  valueMap?: Record<string, string> // For 'value_map'
  dateFormat?: { from: string; to: string }  // For 'date_format'
  constantValue?: unknown          // For 'constant_inject'
}

export interface FieldMappingConfig {
  outbound: FieldMapping[]         // Applied before sending request
  inbound: FieldMapping[]          // Applied to response before domain handler
  outboundStaticFields?: Record<string, unknown>  // Always-append static fields
  inboundStaticFields?: Record<string, unknown>   // Always-inject static fields
  schemaVersion: number
}

// Routing group
export type RoutingStrategy = 'primary_fallback' | 'round_robin' | 'weighted' | 'parallel'
export type ParallelAggregation = 'first_success' | 'all' | 'majority_vote'

export interface IntegrationRoutingGroup {
  routingGroupInstanceReference: string
  routingGroupProviderType: IntegrationProviderType
  routingGroupName: string
  routingGroupStrategy: RoutingStrategy
  routingGroupStatus: 'active' | 'inactive'
  parallelAggregation?: ParallelAggregation
  memberIds: string[]              // externalProviderArrangementInstanceReference[]
  bianServiceDomain: string
  pciDssRequirements: string[]
  recordCreatedDateTime: Date
  recordUpdatedDateTime: Date
}

// Updated provider type
export type IntegrationProviderType =
  | 'fraud_detection'
  | 'aml_monitoring'
  | 'kyc_identity'
  | 'kyb_business'
  | 'hrp_sanctions'
  | 'credit_bureau'
  | 'generic'          // NEW
```

### 4.3 New Collection: `integrationRoutingGroups`

```
{ routingGroupInstanceReference: 1 }  (unique)
{ routingGroupProviderType: 1, routingGroupStatus: 1 }
{ memberIds: 1 }  (multikey — for reverse lookup by provider ID)
```

### 4.4 Updated `integrationRegistry` Indexes

Add new index to support multi-provider queries (remove the unique constraint on type+endpoint that prevented multiple providers of the same type):

```
// Remove: { externalProviderArrangementType: 1, externalProviderApiEndpoint: 1 } unique sparse
// Add:    { externalProviderArrangementType: 1, externalProviderApiEndpoint: 1 } sparse (non-unique)
// Add:    { routingGroupId: 1 }
// Add:    { routingPriority: 1, externalProviderArrangementType: 1 }
```

---

## 5. API Contract Changes

### 5.1 Updated POST /api/v1/integrations (registration)

New optional body fields:

```typescript
{
  // Existing fields unchanged ...

  // NEW
  categoryConfig?: object            // Type-specific configuration
  authConfig?: IntegrationAuthConfig
  fieldMappingConfig?: FieldMappingConfig
  routingGroupId?: string            // Add to existing routing group
  routingPriority?: number           // Default: 100
  routingWeight?: number             // Required for weighted groups
}
```

### 5.2 Updated PATCH /api/v1/integrations/:id

Adds partial update support for the three new sub-documents:

```typescript
PATCH /api/v1/integrations/:id
{
  categoryConfig?: Partial<CategoryConfig>
  authConfig?: Partial<IntegrationAuthConfig>
  fieldMappingConfig?: FieldMappingConfig  // Full replacement (not partial)
  routingPriority?: number
  routingWeight?: number
}
```

### 5.3 New: Routing Group Endpoints

```
GET    /api/v1/integration-groups              List all routing groups
POST   /api/v1/integration-groups              Create routing group
GET    /api/v1/integration-groups/:id          Get group detail + member list
PATCH  /api/v1/integration-groups/:id          Update strategy/status
POST   /api/v1/integration-groups/:id/members  Add provider to group
DELETE /api/v1/integration-groups/:id/members/:providerId  Remove from group
POST   /api/v1/integration-groups/:id/test     Test all members; return health matrix
```

### 5.4 New: Field Mapping Test Endpoint

```
POST /api/v1/integrations/:id/test-mapping
Body: { direction: 'outbound' | 'inbound', payload: object }
Response: { 
  original: object,
  transformed: object,
  appliedRules: FieldMapping[],
  skippedFields: string[],
  errors: string[]
}
```

This endpoint allows the admin to validate field mapping configuration with a sample payload before going live — critical for testing against legacy systems without real transactions.

---

## 6. QE Design Changes

**New DEK: `integrationCredentialsDEK`**

```typescript
// In encryptedFieldsMaps for 'integrationRegistry'
{
  fields: [
    {
      path: 'authTokenEncrypted',
      bsonType: 'string',
      queries: [{ queryType: 'equality' }]
    },
    {
      path: 'authApiKeyEncrypted',
      bsonType: 'string',
      queries: [{ queryType: 'equality' }]
    },
    {
      path: 'authHmacSecretEncrypted',
      bsonType: 'string',
      queries: []  // range query not needed; equality for lookup
    },
    {
      path: 'callbackHmacSecretEncrypted',
      bsonType: 'string',
      queries: []
    },
    {
      path: 'authOauth2SecretEncrypted',
      bsonType: 'string',
      queries: []
    }
  ]
}
```

**Why a separate DEK for integration credentials?**  
Integration credentials are rotated independently of cardholder data. Rotating the `integrationCredentialsDEK` (e.g., after a provider key compromise) does not require re-encryption of QE cardholder fields. The blast radius of a credential DEK compromise is limited to integration auth — not to PANs or cardholder data.

**PCI DSS Req 3.6 compliance**: The `integrationCredentialsDEK` is managed under the same AWS KMS CMK hierarchy as other DEKs (see ADR-002), with its own rotation schedule (90 days recommended for credential material per NIST 800-57).

---

## 7. PCI DSS Compliance Analysis

### Scope of the field mapping engine

The mapping engine operates on **event payload data** — transaction references, risk scores, verification statuses. It does NOT operate on:
- Primary Account Numbers (PAN) — never present in integration payloads
- CVV/CVC — never present in integration payloads  
- Cardholder name — not needed for compliance service calls
- Full card expiry — not needed for fraud scoring input

**Runtime enforcement**: The field mapping engine validates every mapping rule at save time against a PCI DSS blocklist. Any rule that attempts to read, write, or transform PAN/CVV/cardholder fields raises a validation error.

### PCI DSS requirement mapping for new capabilities

| Requirement | New Capability | How it's addressed |
|---|---|---|
| **Req 12.8.1** — List all TPSPs | Multi-provider support | Each provider in a routing group is a separate record with full TPSP documentation |
| **Req 12.8.3** — Due diligence before engagement | Category config | `categoryConfig` documents operational requirements; provider must satisfy them before activation |
| **Req 12.8.5** — Monitor compliance status | Routing group test | `POST /integration-groups/:id/test` runs health checks on all members and records results |
| **Req 3.6** — Key management | Auth credentials QE | `integrationCredentialsDEK` encrypts all auth credentials at rest with QE |
| **Req 10.2.1** — Audit trail | Field mapping log | Dispatch events now include `fieldMappingApplied: boolean` and `mappingRulesCount: number` |
| **Req 6.3.2** — Inventory of bespoke software | Generic integration | `GenericIntegrationConfig.customEventTypes` documents which events flow through generic integrations |
| **Req 12.3.4** — Review hardware/software annually | Auth config expiry | `bearer.tokenExpiresAt` field triggers a UI warning when credentials approach expiry |

---

## 8. BIAN SD-193 Alignment

The proposed enhancements remain within BIAN SD-193 (External Provider Arrangements) boundaries:

| Enhancement | BIAN Mapping |
|---|---|
| `categoryConfig` | `ExternalProviderArrangement.ExternalProviderArrangementRecord` — extends the arrangement with domain-specific terms |
| `fieldMappingConfig` | `ExternalProviderArrangement.ExternalProviderArrangementSpecification` — defines the technical specification of the arrangement |
| `authConfig` | `ExternalProviderArrangement.ExternalProviderArrangementOperationalTerms` — authentication terms are part of operational arrangement |
| `routingGroupId` | `ExternalProviderArrangementPortfolio` — BIAN SD-193 defines a Portfolio behavior qualifier for managing collections of arrangements |
| `generic` type | `ExternalProviderArrangement` — the BIAN standard does not restrict arrangement types; generic is a valid arrangement |
| `IntegrationRoutingGroup` | `ExternalProviderArrangementPortfolio.ExternalProviderArrangementPortfolioFulfillment` — managing a portfolio of providers of the same type |

For the **generic** integration category, `bianServiceDomain` should be set to `"External Provider Arrangements"` (i.e., the management domain itself), and `bianControlRecordType` should be `"ExternalProviderArrangementPortfolio"`.

---

## 9. UI Design

### 9.1 Enhanced Integration List

```
┌─────────────────────────────────────────────────────────────────────────┐
│ External Provider Arrangements        SD-193 · PCI DSS Req 12.8.1       │
│                                                                          │
│ [Search by name...]  [Type ▼]  [Status ▼]  [Routing ▼]   [+ Register]  │
├──────────┬──────────┬────────┬────────┬─────────┬──────────┬────────────┤
│ Provider │ Type     │ Mode   │ Status │ Health  │ Routing  │ Actions    │
├──────────┼──────────┼────────┼────────┼─────────┼──────────┼────────────┤
│ Acme FDS │ Fraud ●  │ Sync   │ Active │ ● OK    │ Group(2) │ [Test][···]│
│ Beta AML │ AML ●    │ Async  │ Active │ ● OK    │ Primary  │ [Test][···]│
│ Fallback │ AML ●    │ Async  │ Active │ ● Deg.  │ Fallback │ [Test][···]│
│ OnfidoKYC│ KYC ●    │ Sync   │ Test   │ ○ Unk.  │ Single   │ [Test][···]│
└──────────┴──────────┴────────┴────────┴─────────┴──────────┴────────────┘
```

New column "Routing" shows: Single / Primary / Fallback / Group(N) — indicating the provider's role in multi-provider setups.

### 9.2 Integration Detail — Tabbed Layout

```
┌─ Acme Fraud Detection Service ─────────── [Active] ──────────────────────┐
│                                                                            │
│  [Overview] [Authentication] [Field Mapping] [Category Config] [Events]  │
│             ────────────────                                               │
│  Auth Type: OAuth2 Client Credentials                                     │
│                                                                            │
│  Client ID:       acme-leafybank-client-001                               │
│  Token Endpoint:  https://auth.acme.io/oauth2/token                      │
│  Scopes:          fraud:score, fraud:history                              │
│  Token Caching:   Enabled (TTL: from token expiry)                        │
│                                                                            │
│  Client Secret:   [••••••••••••••••••] [Rotate] [Clear]                  │
│                   Stored encrypted · Last rotated: 2026-05-15            │
│                                                                            │
│  ─── Outbound Request Headers ─────────────────────────────────────────  │
│  Header: Authorization: Bearer <token>                                    │
└────────────────────────────────────────────────────────────────────────── ┘
```

### 9.3 Field Mapping Tab

```
┌─ Field Mapping ─────────────────────────────────────────────────────────┐
│                                                                          │
│  [Test Mapping with Sample Payload ▼]                                   │
│                                                                          │
│  ── OUTBOUND  (LeafyBank → Acme FDS) ─────────────────────────────────  │
│  ┌──────────────────┬──────────────────┬────────────────┬───────┐       │
│  │ Internal Field   │ External Field   │ Transform      │       │       │
│  ├──────────────────┼──────────────────┼────────────────┼───────┤       │
│  │ caseId           │ reference_id     │ rename         │ [×]   │       │
│  │ transactionAmt   │ amount_cents     │ scale ×100     │ [×]   │       │
│  │ merchantId       │ merchant_ref     │ rename         │ [×]   │       │
│  │ — — —            │ source           │ constant: "LB" │ [×]   │       │
│  └──────────────────┴──────────────────┴────────────────┴───────┘       │
│                                               [+ Add outbound rule]      │
│                                                                          │
│  ── INBOUND  (Acme FDS → LeafyBank) ──────────────────────────────────  │
│  ┌──────────────────┬──────────────────┬────────────────┬───────┐       │
│  │ External Field   │ Internal Field   │ Transform      │       │       │
│  ├──────────────────┼──────────────────┼────────────────┼───────┤       │
│  │ risk_score       │ fraudScore       │ scale ×1       │ [×]   │       │
│  │ recommendation   │ externalRec      │ value map      │ [×]   │       │
│  │   HIGH→high_risk │                  │                │       │       │
│  │   MED→medium     │                  │                │       │       │
│  └──────────────────┴──────────────────┴────────────────┴───────┘       │
│                                               [+ Add inbound rule]       │
│                                                                          │
│  [Save Mapping]  [Test with Sample]  [Reset to Defaults]                │
└──────────────────────────────────────────────────────────────────────── ┘
```

### 9.4 Category Config Tab (example: Fraud Detection)

```
┌─ Category Configuration — Fraud Detection (SD-63) ─────────────────────┐
│                                                                          │
│  Score Thresholds ────────────────────────────────────────────────────  │
│  Low risk:    below  [30  ]   Medium risk: below  [70  ]                │
│  (above 70 = High risk)                                                 │
│                                                                          │
│  Response Field Names ─────────────────────────────────────────────────  │
│  Score field:           [risk_score                          ]           │
│  Recommendation field:  [recommendation                     ]           │
│                                                                          │
│  Operational Settings ─────────────────────────────────────────────────  │
│  Real-time required:    [✓]     Batch supported:    [✓]                 │
│  Score scale max:       [100 ]  Model version:      [v2.1.0  ]          │
│                                                                          │
│  [Save Category Config]                                                  │
└──────────────────────────────────────────────────────────────────────── ┘
```

---

## 10. Implementation Plan

### Phase 1 — Data Model and Backend (2 sessions)

1. Add `categoryConfig`, `authConfig`, `fieldMappingConfig`, `routingGroupId` fields to `ExternalProviderArrangement` model
2. Add new type definitions: `FieldMapping`, `FieldMappingConfig`, `IntegrationAuthConfig`, all `CategoryConfig` types, `IntegrationRoutingGroup`
3. Add `generic` to `IntegrationProviderType`
4. Create `integrationRoutingGroups` collection with indexes
5. Update `integrationRegistry` indexes (remove unique constraint on type+endpoint)
6. Add `integrationCredentialsDEK` to QE setup (technical-spec.md §2 update)
7. Implement `FieldMappingEngine` service (apply outbound/inbound transforms)
8. Update `integrationDispatch.service.ts` — apply outbound mapping, route through group strategy
9. Update `integrationCallback.service.ts` — apply inbound mapping
10. Update `integrationRegistry.service.ts` — CRUD for new fields, routing group management
11. Add new API endpoints (routing groups, test-mapping)

### Phase 2 — Frontend (2 sessions)

1. Refactor integration detail page to tab-based layout
2. Implement Authentication Config tab (schema-driven form per auth type)
3. Implement Field Mapping tab (table UI with inline edit, test-mapping panel)
4. Implement Category Config tab (type-specific form per category)
5. Add Routing tab (group membership, strategy selector, member health matrix)
6. Update registration wizard to 5-step flow
7. Update integration list: add Routing column, Generic category filter

### Phase 3 — Docs and ADRs (1 session)

1. Add ADR-013 through ADR-017 to engineering-proposal.md
2. Update technical-spec.md §1.13 (updated data model) and §2 (new DEK)
3. Update technical-spec.md §6 (new API endpoints)
4. Update roadmap.md (mark Phase 2 items complete, add Phase 3 items)

---

## 11. Open Questions

| # | Question | Recommended Answer |
|---|---|---|
| OQ-1 | Should routing groups be a separate collection or embedded in the registry? | Separate collection — groups have their own lifecycle independent of individual providers |
| OQ-2 | Should the field mapping engine support JSONPath or only dot-notation? | Start with dot-notation; JSONPath adds complexity and is rarely needed for compliance payloads |
| OQ-3 | Should the `parallel/majority_vote` aggregation support custom tiebreak logic? | No — keep it simple for the demo; tiebreak = first alphabetical `externalProviderArrangementInstanceReference` |
| OQ-4 | Should `generic` integrations appear in the BIAN mapping panel? | Yes — mapped to "External Provider Arrangements" (SD-193 itself) as catch-all |
| OQ-5 | Should field mapping rules be exportable/importable (e.g., JSON template)? | Yes — useful for demo presentations; implement as download/upload JSON in the UI |
| OQ-6 | Should the QE change to `integrationRegistry` require a collection migration? | Only new records use the new QE fields; existing records continue using bcrypt hash fields (coexistence) |
