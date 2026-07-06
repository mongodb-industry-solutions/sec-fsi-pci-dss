// Internal FDS (Fraud Detection) engine — the built-in scorer used when no external fraud vendor is
// active (internal-first, ADR-010/029). Distinct from Fraud Diagnosis (SD-83). The engine is
// DATA-DRIVEN: its rules live in the Module config (capabilityModuleConfiguration.moduleConfig for
// `fds`) so an operator can add/edit rules from the admin UI without code (P13.2/P13.5). Pure function.
//
// EXPLICIT RULE MODEL
//   Each rule fires when `input[when.field] <op> when.value`; a fired rule contributes `score` points
//   and may force an action ('review' | 'decline'). The verdict is the aggregate:
//     riskScore       = min(100, sum of fired scores)   (floored at 10 so an approve is never 0)
//     recommendation  = 'decline' if any fired rule forces decline OR total >= bands.declineAtOrAbove
//                       'review'  if any fired rule forces review  OR total >= bands.reviewAtOrAbove
//                       'approve' otherwise
//     fraudFlag       = recommendation !== 'approve'
//     rulesFired      = the ids of the rules that actually fired (no hardcoded list)
//
// CONFIG SHORTHANDS — when `rules` is not provided, the default rule set is synthesised from the
// `amount` / `riskyMcc` / `velocity` shorthands so the simple admin form keeps working. A power user
// can instead supply an explicit `rules[]`. Both feed the same evaluator.
import { FdsInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

export type FdsRuleOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'in' | 'nin';

export interface FdsRule {
  id: string;
  label: string;
  when: { field: string; op: FdsRuleOp; value: number | string | Array<number | string> };
  score: number;
  action?: 'review' | 'decline';
  enabled?: boolean; // default true
}

export interface FdsModuleConfig {
  amount?: { reviewAmount?: number; declineAmount?: number };
  riskyMcc?: string[];
  velocity?: { window24hMax?: number };
  bands?: { reviewAtOrAbove?: number; declineAtOrAbove?: number };
  rules?: FdsRule[];
}

// Back-compat: the previous config shape was { thresholds: { reviewAmount } }.
export interface FdsThresholds { reviewAmount: number }

// Defaults. reviewAmount is 500 to match the PSP fraud-case threshold (D3, single source of truth);
// the PSP `shouldCreateFraudCase` consumes the SAME value. No auto-decline on amount by default.
export const FDS_DEFAULTS = {
  reviewAmount: 500,
  reviewAtOrAbove: 50,
} as const;

// Build the effective, explicit rule set. If the config gives `rules`, use them verbatim; otherwise
// synthesise the documented default rules from the shorthands. Exported so the admin UI can preview
// the rules currently in force.
export function resolveFdsRules(config?: FdsModuleConfig): FdsRule[] {
  if (config?.rules && config.rules.length) {
    return config.rules.filter((r) => r.enabled !== false);
  }
  const reviewAmount = config?.amount?.reviewAmount ?? FDS_DEFAULTS.reviewAmount;
  const declineAmount = config?.amount?.declineAmount;
  const riskyMcc = config?.riskyMcc ?? [];
  const window24hMax = config?.velocity?.window24hMax;

  const rules: FdsRule[] = [
    { id: 'HIGH_VALUE_TXN', label: `Amount over ${reviewAmount}`, when: { field: 'amount', op: 'gt', value: reviewAmount }, score: 60, action: 'review' },
    { id: 'ELEVATED_VALUE_TXN', label: `Amount over ${Math.round(reviewAmount / 2)}`, when: { field: 'amount', op: 'gt', value: Math.round(reviewAmount / 2) }, score: 40 },
  ];
  if (riskyMcc.length) {
    rules.push({ id: 'RISKY_MCC', label: 'Merchant category on the risky list', when: { field: 'merchantCategoryCode', op: 'in', value: riskyMcc }, score: 35, action: 'review' });
  }
  if (typeof window24hMax === 'number') {
    rules.push({ id: 'VELOCITY_24H', label: `More than ${window24hMax} transactions in 24h`, when: { field: 'recentTransactionCount24h', op: 'gt', value: window24hMax }, score: 30, action: 'review' });
  }
  if (typeof declineAmount === 'number') {
    rules.push({ id: 'VERY_HIGH_VALUE_TXN', label: `Amount at or over ${declineAmount}`, when: { field: 'amount', op: 'gte', value: declineAmount }, score: 100, action: 'decline' });
  }
  return rules;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ruleFires(rule: FdsRule, input: Record<string, unknown>): boolean {
  const actual = input[rule.when.field];
  if (actual === undefined || actual === null) return false;
  const { op, value } = rule.when;
  switch (op) {
    case 'gt': return toNumber(actual) > toNumber(value);
    case 'gte': return toNumber(actual) >= toNumber(value);
    case 'lt': return toNumber(actual) < toNumber(value);
    case 'lte': return toNumber(actual) <= toNumber(value);
    case 'eq': return String(actual) === String(value);
    case 'ne': return String(actual) !== String(value);
    case 'in': return Array.isArray(value) && value.map(String).includes(String(actual));
    case 'nin': return Array.isArray(value) && !value.map(String).includes(String(actual));
    default: return false;
  }
}

// Score a transaction against the effective rule set. `thresholdsOrConfig` accepts either the new
// FdsModuleConfig or the legacy { reviewAmount } thresholds shape (mapped to amount.reviewAmount).
export function scoreFds(
  input: Record<string, unknown>,
  thresholdsOrConfig?: Partial<FdsThresholds> | FdsModuleConfig,
): FdsInboundPayload {
  const config = normaliseConfig(thresholdsOrConfig);
  // Field mapping: the gate dispatches `amount`; tolerate the legacy `transactionAmount` too.
  const amount = toNumber(input.amount ?? input.transactionAmount);
  const evalInput: Record<string, unknown> = { ...input, amount: Number.isFinite(amount) ? amount : 0 };

  const rules = resolveFdsRules(config);
  const reviewAtOrAbove = config.bands?.reviewAtOrAbove ?? FDS_DEFAULTS.reviewAtOrAbove;
  const declineAtOrAbove = config.bands?.declineAtOrAbove;

  let total = 0;
  let forceDecline = false;
  let forceReview = false;
  const rulesFired: string[] = [];
  for (const rule of rules) {
    if (ruleFires(rule, evalInput)) {
      total += rule.score;
      rulesFired.push(rule.id);
      if (rule.action === 'decline') forceDecline = true;
      if (rule.action === 'review') forceReview = true;
    }
  }

  const riskScore = Math.min(100, Math.max(rulesFired.length ? total : 10, 10));
  let recommendation: 'approve' | 'review' | 'decline' = 'approve';
  if (forceDecline || (typeof declineAtOrAbove === 'number' && total >= declineAtOrAbove)) {
    recommendation = 'decline';
  } else if (forceReview || total >= reviewAtOrAbove) {
    recommendation = 'review';
  }

  return { riskScore, fraudFlag: recommendation !== 'approve', recommendation, rulesFired };
}

// Accept the legacy thresholds shape and map it onto the config model.
function normaliseConfig(input?: Partial<FdsThresholds> | FdsModuleConfig): FdsModuleConfig {
  if (!input) return {};
  if ('reviewAmount' in input && typeof (input as FdsThresholds).reviewAmount === 'number') {
    return { amount: { reviewAmount: (input as FdsThresholds).reviewAmount } };
  }
  return input as FdsModuleConfig;
}
