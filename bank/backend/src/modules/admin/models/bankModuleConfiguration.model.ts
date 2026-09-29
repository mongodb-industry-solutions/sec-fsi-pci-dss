// Configuration of the bank's own engines, held in the database and edited over the bank's REST API.
//
// This mirrors the PSP's `capabilityModuleConfiguration` deliberately: every option that used to be set
// on a PSP provider (the card issuer's accepted CVV, its supported networks, the AIS and PIS behaviour)
// must remain settable once the engine lives here, and it must be settable through an API rather than a
// redeploy. What changes is only which service owns the record.
//
// **Not Open Banking, and it does not pretend to be.** No standard covers "configure the bank's card
// simulator", so this is plain REST at an administration path, kept off the `/v1` surface a TPP sees. The
// financial operations stay standard; the knobs behind them are ours.
export const BANK_MODULE_CONFIGURATION_COLLECTION = 'bankModuleConfiguration';

// The engines the bank owns, or will own. Named after the semantic banking domain, matching the module
// directories, so a reader moves between the two without translating.
export type BankCapabilityKey =
  | 'consent'
  | 'aisp'
  | 'pisp'
  | 'aspsp'
  | 'payment-hub'
  | 'card-issuer'
  | 'card-authorization'
  | 'credit-bureau';

export const BANK_CAPABILITY_KEYS: BankCapabilityKey[] = [
  'consent', 'aisp', 'pisp', 'aspsp', 'payment-hub', 'card-issuer', 'card-authorization', 'credit-bureau',
];

export interface BankModuleConfigurationControlRecord {
  // The capability key is the reference: one configuration document per engine.
  bankModuleConfigurationInstanceReference: BankCapabilityKey;
  bankModuleCapability: BankCapabilityKey;
  bankModuleDescription: string;
  // Free-form per capability, exactly as the PSP's module configuration is. The engine that reads it
  // owns its shape and merges it over its own defaults, so a partial document is always valid.
  bankModuleConfiguration: Record<string, unknown>;
  bankModuleConfigurationStatus: 'active' | 'inactive';
  // Whether an engine in this bank actually reads it yet. An engine that has not moved here has its
  // configuration surface ready and says so, rather than looking like a setting that does nothing.
  bankModuleConfigurationConsumed: boolean;
  bankModuleConfigurationUpdatedBy?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'BankModuleConfiguration';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
