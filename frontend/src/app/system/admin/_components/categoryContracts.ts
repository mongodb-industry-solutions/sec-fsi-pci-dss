// Category data contracts and trigger events for each IntegrationProviderType.
// These are canonical definitions; not fetched from the API. They describe the
// protocol between LeafyBank and any provider of that type.

export interface ContractField {
  name: string;
  type: string;
  description: string;
  required: boolean;
  pciSensitive?: boolean;
}

export interface CategoryContract {
  inputs: ContractField[];
  outputs: ContractField[];
}

export interface TriggerEvent {
  event: string;
  description: string;
}

export const CATEGORY_CONTRACTS: Record<string, CategoryContract> = {
  fraud_detection: {
    inputs: [
      { name: 'transactionInstanceReference', type: 'string (UUID)', description: 'Unique transaction identifier', required: true },
      { name: 'transactionAmount',             type: 'number',        description: 'Transaction amount in minor currency units (cents)', required: true },
      { name: 'transactionCurrency',           type: 'string (ISO 4217)', description: 'Currency code e.g. USD, EUR', required: true },
      { name: 'merchantCategoryCode',          type: 'string',        description: 'MCC code of the merchant', required: true },
      { name: 'cardTransactionChannel',        type: 'string',        description: 'Channel: online | pos | atm | contactless', required: true },
      { name: 'deviceFingerprint',             type: 'string',        description: 'Hashed device fingerprint (optional)', required: false },
    ],
    outputs: [
      { name: 'fraudScore',       type: 'number',   description: 'Risk score from 0 to 100 (or 0.0–1.0 per scoreScaleMax)', required: true },
      { name: 'recommendation',   type: 'string',   description: 'Decision: approve | review | decline', required: true },
      { name: 'modelVersion',     type: 'string',   description: 'Provider model version used', required: false },
      { name: 'rulesFired',       type: 'string[]', description: 'List of rules triggered during evaluation', required: false },
      { name: 'processingTimeMs', type: 'number',   description: 'Provider internal processing latency (ms)', required: false },
    ],
  },

  hrp_sanctions: {
    inputs: [
      { name: 'partyInstanceReference', type: 'string (UUID)', description: 'Party being screened', required: true },
      { name: 'partyName',              type: 'string',        description: 'Full legal name of the party', required: true },
      { name: 'partyDateOfBirth',       type: 'string (ISO 8601)', description: 'Date of birth for identity matching', required: false },
      { name: 'partyNationality',       type: 'string (ISO 3166-1)', description: 'Nationality country code', required: false },
      { name: 'documentNumber',         type: 'string',        description: 'Government document number (not PAN)', required: false },
      { name: 'screeningContext',        type: 'string',        description: 'Context: onboarding | transaction | periodic', required: true },
    ],
    outputs: [
      { name: 'matchScore',          type: 'number',   description: 'Fuzzy match score 0–100', required: true },
      { name: 'matchFound',          type: 'boolean',  description: 'Whether a match was found above threshold', required: true },
      { name: 'hitList',             type: 'object[]', description: 'List of matched entries with source and score', required: false },
      { name: 'hitDisposition',      type: 'string',   description: 'Disposition: cleared | confirmed | pending_review', required: false },
      { name: 'screeningReference',  type: 'string',   description: 'External reference ID for this screening', required: true },
    ],
  },

  kyc_identity: {
    inputs: [
      { name: 'partyInstanceReference', type: 'string (UUID)', description: 'Party to verify', required: true },
      { name: 'verificationLevel',      type: 'string',        description: 'Level: basic | enhanced | full', required: true },
      { name: 'documentType',           type: 'string',        description: 'Document: passport | national_id | drivers_license', required: true },
      { name: 'documentNumber',         type: 'string',        description: 'Document identification number', required: true },
      { name: 'partyName',              type: 'string',        description: 'Full legal name as on document', required: true },
      { name: 'partyDateOfBirth',       type: 'string (ISO 8601)', description: 'Date of birth', required: true },
      { name: 'consentReference',       type: 'string',        description: 'Reference to recorded data-processing consent', required: true },
    ],
    outputs: [
      { name: 'verificationStatus',    type: 'string',   description: 'Status: verified | pending | rejected | expired', required: true },
      { name: 'verificationReference', type: 'string',   description: 'Provider reference for audit trail', required: true },
      { name: 'confidenceScore',       type: 'number',   description: 'Confidence 0–100', required: false },
      { name: 'failureReasons',        type: 'string[]', description: 'Reasons for rejection if applicable', required: false },
      { name: 'verifiedAt',            type: 'string (ISO 8601)', description: 'Timestamp of verification', required: false },
    ],
  },

  kyb_business: {
    inputs: [
      { name: 'merchantInstanceReference', type: 'string (UUID)', description: 'Merchant being verified', required: true },
      { name: 'businessName',              type: 'string',        description: 'Registered legal business name', required: true },
      { name: 'registrationNumber',        type: 'string',        description: 'Company registration number', required: true },
      { name: 'registrationCountry',       type: 'string (ISO 3166-1)', description: 'Country of registration', required: true },
      { name: 'businessType',              type: 'string',        description: 'Entity type: llc | corporation | partnership | sole_proprietor', required: true },
      { name: 'uboList',                   type: 'object[]',      description: 'Ultimate beneficial owners (threshold per categoryConfig)', required: false },
    ],
    outputs: [
      { name: 'dueDiligenceStatus',  type: 'string',  description: 'Status: approved | pending | rejected | enhanced_required', required: true },
      { name: 'riskScore',           type: 'number',  description: 'Business risk score 0–100', required: true },
      { name: 'uboVerified',         type: 'boolean', description: 'Whether all UBOs above threshold were verified', required: true },
      { name: 'pepFound',            type: 'boolean', description: 'Politically exposed person found in ownership chain', required: true },
      { name: 'adverseMediaFound',   type: 'boolean', description: 'Adverse media screening result', required: false },
      { name: 'renewalDate',         type: 'string (ISO 8601)', description: 'Date when KYB verification expires', required: false },
    ],
  },

  aml_monitoring: {
    inputs: [
      { name: 'subjectReference',     type: 'string (UUID)', description: 'Party or merchant being screened', required: true },
      { name: 'subjectType',          type: 'string',        description: 'Subject type: individual | business', required: true },
      { name: 'screeningType',        type: 'string',        description: 'Type: customer_onboarding | transaction | batch_periodic', required: true },
      { name: 'transactionReference', type: 'string',        description: 'Transaction reference (required for transaction screenings)', required: false },
      { name: 'transactionAmount',    type: 'number',        description: 'Transaction amount in minor currency units', required: false },
      { name: 'watchlistSources',     type: 'string[]',      description: 'Watchlists to query (overrides categoryConfig defaults)', required: false },
    ],
    outputs: [
      { name: 'screeningReference', type: 'string',   description: 'External reference for this screening session', required: true },
      { name: 'alertGenerated',     type: 'boolean',  description: 'Whether an AML alert was raised', required: true },
      { name: 'alertSeverity',      type: 'string',   description: 'Severity: low | medium | high | critical', required: false },
      { name: 'matchedLists',       type: 'string[]', description: 'Watchlists where the subject was found', required: false },
      { name: 'sarRequired',        type: 'boolean',  description: 'Whether a Suspicious Activity Report should be filed', required: true },
      { name: 'nextScreeningDate',  type: 'string (ISO 8601)', description: 'Scheduled next screening date', required: false },
    ],
  },

  credit_bureau: {
    inputs: [
      { name: 'partyInstanceReference', type: 'string (UUID)', description: 'Party whose credit is being assessed', required: true },
      { name: 'pullType',               type: 'string',        description: 'Pull type: soft | hard', required: true },
      { name: 'consentReference',       type: 'string',        description: 'Reference to credit pull consent', required: true },
      { name: 'partyName',              type: 'string',        description: 'Full legal name for bureau lookup', required: true },
      { name: 'partyDateOfBirth',       type: 'string (ISO 8601)', description: 'Date of birth for identity matching', required: true },
    ],
    outputs: [
      { name: 'creditScore',      type: 'number', description: 'Credit score (range per bureauConfig)', required: true },
      { name: 'scoringModel',     type: 'string', description: 'Model used for scoring (e.g. FICO8, VantageScore)', required: true },
      { name: 'bureauReference',  type: 'string', description: 'Bureau report reference ID', required: true },
      { name: 'reportDate',       type: 'string (ISO 8601)', description: 'Date of the credit report', required: true },
      { name: 'negativeItems',    type: 'number', description: 'Count of negative tradelines', required: false },
      { name: 'inquiries90Days', type: 'number', description: 'Hard inquiries in last 90 days', required: false },
    ],
  },

  card_authorization: {
    inputs: [
      { name: 'cardToken',                      type: 'string',        description: 'Tokenized card reference (no PAN)', required: true, pciSensitive: true },
      { name: 'transactionAmount',              type: 'number',        description: 'Authorization amount in minor currency units', required: true },
      { name: 'transactionCurrency',            type: 'string (ISO 4217)', description: 'Currency code e.g. USD, EUR', required: true },
      { name: 'merchantCode',                   type: 'string',        description: 'Merchant code from categoryConfig', required: true },
      { name: 'cardAuthorizationOutcome',       type: 'string',        description: 'Hint for simulator: approved | declined | challenge', required: false },
    ],
    outputs: [
      { name: 'authorizationResult',             type: 'string',  description: 'Result: approved | declined | pending_3ds', required: true },
      { name: 'cardTransactionInstanceReference', type: 'string', description: 'Authorization reference for audit trail', required: true },
      { name: 'responseCode',                    type: 'string',  description: 'ISO 8583 response code (e.g. 00, 05, 51)', required: true },
    ],
  },

  card_issuer: {
    inputs: [
      { name: 'cardToken',      type: 'string',        description: 'Tokenized card reference (no PAN in transit)', required: true, pciSensitive: true },
      { name: 'cvvHash',        type: 'string',        description: 'Hashed CVV2/CVC2 value for validation (never plaintext)', required: false, pciSensitive: true },
      { name: 'pinBlock',       type: 'string',        description: 'Encrypted PIN block (ISO-0/ISO-3/ISO-4 format per categoryConfig)', required: false, pciSensitive: true },
      { name: 'cardNetwork',    type: 'string',        description: 'Card network: visa | mastercard | amex | discover', required: true },
      { name: 'validationMode', type: 'string',        description: 'Validation type: cvv | pin | cvv_and_pin', required: true },
    ],
    outputs: [
      { name: 'cvvValidationResult', type: 'string',  description: 'CVV result: match | no_match | not_processed', required: false },
      { name: 'pinValidationResult', type: 'string',  description: 'PIN result: verified | wrong_pin | blocked | not_processed', required: false },
      { name: 'responseCode',        type: 'string',  description: 'Issuer response code (e.g. 00 = ok, 55 = wrong PIN)', required: true },
      { name: 'issuerAuthCode',      type: 'string',  description: 'Issuer authorization code (6 chars, only when approved)', required: false },
    ],
  },

  generic: {
    inputs: [
      { name: 'subjectReference', type: 'string', description: 'Reference to the subject entity (configurable)', required: true },
      { name: 'eventType',        type: 'string', description: 'Custom event type (per categoryConfig.customEventTypes)', required: true },
      { name: 'eventPayload',     type: 'object', description: 'Event data; structure defined by outbound field mappings', required: false },
    ],
    outputs: [
      { name: 'status',          type: 'string', description: 'Processing result from external provider', required: true },
      { name: 'responsePayload', type: 'object', description: 'Response data; structure defined by inbound field mappings', required: false },
    ],
  },
};

export const CATEGORY_TRIGGER_EVENTS: Record<string, TriggerEvent[]> = {
  fraud_detection: [
    { event: 'transaction.authorized',  description: 'Transaction authorized by the PSP' },
    { event: 'transaction.flagged',     description: 'Transaction flagged by an internal rule engine' },
    { event: 'fraud.case.opened',       description: 'Fraud investigation case opened manually by analyst' },
  ],
  hrp_sanctions: [
    { event: 'customer.onboarding.initiated', description: 'New customer onboarding process started' },
    { event: 'transaction.high.risk',         description: 'Transaction scored as high-risk by FDS' },
    { event: 'periodic.rescan',               description: 'Periodic rescreening triggered by scheduled batch job' },
  ],
  kyc_identity: [
    { event: 'customer.onboarding.initiated', description: 'New customer onboarding process started' },
    { event: 'kyc.reverification.required',   description: 'KYC verification expired or re-verification requested' },
    { event: 'account.risk.elevated',         description: 'Account risk level elevated by risk engine' },
  ],
  kyb_business: [
    { event: 'merchant.onboarding.initiated', description: 'New merchant onboarding process started' },
    { event: 'merchant.annual.review',        description: 'Annual merchant due diligence review triggered' },
    { event: 'ubo.change.reported',           description: 'Change in beneficial ownership structure reported' },
  ],
  aml_monitoring: [
    { event: 'customer.onboarding.initiated', description: 'New customer onboarding process started' },
    { event: 'transaction.authorized',        description: 'Transaction authorized and subject to AML check' },
    { event: 'periodic.aml.rescan',           description: 'Periodic AML screening batch job triggered' },
    { event: 'sar.threshold.exceeded',        description: 'Aggregate transaction amount crossed SAR reporting threshold' },
  ],
  credit_bureau: [
    { event: 'customer.onboarding.initiated', description: 'New customer onboarding; initial credit pull' },
    { event: 'credit.assessment.requested',   description: 'Explicit credit assessment requested for loan/limit review' },
    { event: 'customer.agreement.review',     description: 'Periodic customer agreement review requires credit refresh' },
  ],
  generic: [
    { event: '(custom)',  description: 'Events defined in categoryConfig.customEventTypes for this provider' },
  ],
  card_authorization: [
    { event: 'checkout.pay',       description: 'Checkout session pay action triggered by cardholder' },
    { event: 'payment.link.pay',   description: 'Payment link pay action triggered by cardholder' },
  ],
  card_issuer: [
    { event: 'checkout.cvv.validation',   description: 'CVV2/CVC2 validation check triggered during checkout' },
    { event: 'payment.pin.verification',  description: 'PIN verification requested for POS or high-value transaction' },
    { event: 'card.activation.cvv',       description: 'CVV check required as part of card activation workflow' },
  ],
};
