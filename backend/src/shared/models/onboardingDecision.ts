// v31: onboarding decision policy + verdict→status mappers (plan §3.7, §4.0).
// Pure, no I/O. BIAN BQ:Step vocabulary only (§3.6): a check status is one of
// initiated | verified | rejected | expired. `passed`/`failed`/`pending` are NEVER lifecycle statuses.
//
// One deterministic mapper per process, shared by BOTH the internal saga path AND the external
// callback path, so the risk verdict and the BQ:Step status are always derived the same way (no drift).

export type DecisionMode = 'manual' | 'automated' | 'assisted';

// Decision-mode config, stored per capability in capabilityModuleConfiguration.moduleConfig (kyc/kyb),
// edited from the Configuration tab. The PROVIDER never sets these: it returns evidence; the PSP
// decides how evidence resolves. Unknown/unset decisionMode → default `manual` (fail-safe).
export interface DecisionModeConfig {
  decisionMode?: DecisionMode;
  decisionAutoApproveMaxRisk?: 'low';                 // automated: only auto-APPROVE at/below this risk
  decisionAutoRejectOn?: DecisionAutoRejectTrigger[]; // auto-REJECT triggers
  decisionEscalateToManualOn?: DecisionEscalateTrigger[];
}
export type DecisionAutoRejectTrigger = 'sanctions_hit' | 'kyb_failed' | 'kyc_failed';
export type DecisionEscalateTrigger = 'pep_hit' | 'adverse_media_hit' | 'provider_timeout';

/** Resolve the effective decision mode with the fail-safe default. */
export function effectiveDecisionMode(cfg: DecisionModeConfig | undefined | null): DecisionMode {
  const m = cfg?.decisionMode;
  return m === 'automated' || m === 'assisted' ? m : 'manual';
}

type CheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

// Provider wire verdict (externalProviderArrangement transport vocabulary). Mapped FIRST.
export type ProviderWireVerdict = 'pass' | 'fail' | 'manual_review';

export interface KycVerdictInput {
  riskRating?: 'low' | 'medium' | 'high';
  pepStatus?: boolean;
  sanctionsResult?: 'clear' | 'hit' | 'pending';
  verificationStatus?: ProviderWireVerdict; // present on external callbacks; absent on internal HRP
}

export interface KybVerdictInput {
  businessRiskLevel?: 'low' | 'medium' | 'high';
  sanctionsResult?: 'clear' | 'hit' | 'pending';
  adverseMediaResult?: 'clear' | 'hit' | 'pending';
  verificationStatus?: ProviderWireVerdict;
}

// Rules (§3.7), consistent with §3.6 and the §4.0 guardrails:
//  - Hard fail (sanctions hit / verification fail) → `rejected` in ANY mode.
//  - automated + low risk + no PEP/sanctions → `verified`.
//  - manual / assisted / any escalation → stays `initiated` (no under_review in the 4-term BQ vocab;
//    the AGREEMENT carries under_review). The officer's later Control action sets verified/rejected.
//  - `expired` is owned by a separate re-screen/TTL policy (out of v31 scope; never set here).
export function deriveKycCheckStatus(verdict: KycVerdictInput, mode: DecisionMode): CheckStatus {
  if (verdict.sanctionsResult === 'hit' || verdict.verificationStatus === 'fail') return 'rejected';
  if (verdict.verificationStatus === 'manual_review') return 'initiated';
  // Verify ONLY on an affirmatively CLEAN screening: sanctions must be explicitly `clear` (a `pending`
  // or missing result means the screening is incomplete and must not auto-verify), low risk, no PEP.
  if (mode === 'automated' && verdict.riskRating === 'low' && verdict.pepStatus !== true && verdict.sanctionsResult === 'clear') return 'verified';
  return 'initiated';
}

export function deriveKybCheckStatus(verdict: KybVerdictInput, mode: DecisionMode): CheckStatus {
  if (verdict.sanctionsResult === 'hit' || verdict.verificationStatus === 'fail') return 'rejected';
  if (verdict.verificationStatus === 'manual_review') return 'initiated';
  // Verify ONLY on an affirmatively CLEAN screening: both sanctions and adverse media must be explicitly
  // `clear` (a `pending`/missing result is incomplete and must not auto-verify), low business risk.
  if (mode === 'automated' && verdict.businessRiskLevel === 'low' && verdict.sanctionsResult === 'clear' && verdict.adverseMediaResult === 'clear') {
    return 'verified';
  }
  return 'initiated';
}

// Terminal AGREEMENT resolution for the onboarding saga (§5bis.5). Returns the action the saga should
// take. HARD GUARDRAIL: a sanctions/PEP hit can NEVER auto-approve, even in `automated`.
export type SagaResolution =
  | { action: 'auto_approve'; reason: string }
  | { action: 'auto_reject'; reason: string }
  | { action: 'escalate'; reason: string }         // stays under_review; officer decides
  | { action: 'recommend'; recommended: 'approve' | 'reject'; reason: string }; // assisted (HITL)

export interface KybResolutionVerdict {
  businessRiskLevel?: 'low' | 'medium' | 'high';
  sanctionsResult?: 'clear' | 'hit' | 'pending';
  adverseMediaResult?: 'clear' | 'hit' | 'pending';
  pepHit?: boolean; // aggregated from owner-layer KYC (any UBO PEP/sanctions hit)
}

export function resolveKybOnboarding(verdict: KybResolutionVerdict, cfg: DecisionModeConfig | undefined | null): SagaResolution {
  const mode = effectiveDecisionMode(cfg);
  const hardHit = verdict.sanctionsResult === 'hit';
  const pepOrMediaHit = verdict.pepHit === true || verdict.adverseMediaResult === 'hit';

  // Hard fail auto-rejects in every non-manual mode; manual leaves it for the officer.
  if (hardHit) {
    if (mode === 'manual') return { action: 'escalate', reason: 'sanctions_hit (manual mode: officer decides)' };
    return { action: 'auto_reject', reason: 'sanctions_hit' };
  }

  if (mode === 'manual') return { action: 'escalate', reason: 'manual decision mode' };

  // Guardrail: sanctions/PEP/adverse-media never auto-approve → escalate (or recommend reject).
  if (pepOrMediaHit) {
    if (mode === 'assisted') return { action: 'recommend', recommended: 'reject', reason: 'pep/adverse_media hit' };
    return { action: 'escalate', reason: 'pep/adverse_media hit escalates to manual' };
  }

  const maxRisk = cfg?.decisionAutoApproveMaxRisk ?? 'low';
  // Only 'low' is an auto-approvable risk level today (decisionAutoApproveMaxRisk is fixed at 'low').
  const riskOk = maxRisk === 'low' && verdict.businessRiskLevel === 'low';

  if (mode === 'assisted') {
    return { action: 'recommend', recommended: riskOk ? 'approve' : 'reject', reason: `assisted recommendation (risk=${verdict.businessRiskLevel ?? 'unknown'})` };
  }

  // automated
  if (riskOk) return { action: 'auto_approve', reason: `risk<=${maxRisk}, no sanctions/PEP/adverse-media` };
  return { action: 'escalate', reason: `risk=${verdict.businessRiskLevel ?? 'unknown'} above auto-approve threshold` };
}
