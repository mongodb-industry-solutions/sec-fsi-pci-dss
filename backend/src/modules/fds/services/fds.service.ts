// Internal FDS (Fraud Detection) engine — the built-in scorer used when no external fraud vendor
// is active (internal-first, ADR-010/029). Pure function; thresholds overridable from the Module
// config (capabilityModuleConfiguration.moduleConfig). Distinct from Fraud Diagnosis (SD-83).
import { FdsInboundPayload } from '../../providers/models/externalProviderArrangement.model';

export interface FdsThresholds {
  reviewAmount: number; // amount above which the transaction is flagged for review
}

const DEFAULTS: FdsThresholds = { reviewAmount: 1000 };

export function scoreFds(
  input: Record<string, unknown>,
  thresholds?: Partial<FdsThresholds>,
): FdsInboundPayload {
  const reviewAmount = thresholds?.reviewAmount ?? DEFAULTS.reviewAmount;
  const amount = (input.transactionAmount as number) ?? 0;
  const flagged = amount > reviewAmount;
  return {
    riskScore: flagged ? 75 : amount > reviewAmount / 2 ? 45 : 15,
    fraudFlag: flagged,
    recommendation: flagged ? 'review' : 'approve',
    rulesFired: flagged ? ['HIGH_VALUE_TXN', 'VELOCITY_CHECK'] : [],
  };
}
