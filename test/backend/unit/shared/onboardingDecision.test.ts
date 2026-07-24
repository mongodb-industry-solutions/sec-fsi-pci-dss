/**
 * Unit tests (v31): onboarding decision policy + verdict→status mappers (plan §3.6, §3.7, §4.0).
 * Source: backend/src/shared/models/onboardingDecision.ts
 *
 * BIAN BQ:Step vocabulary only. No `passed`/`failed`/`pending` as a lifecycle status.
 * Hard guardrail: a sanctions/PEP hit can never auto-approve.
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveDecisionMode,
  deriveKycCheckStatus,
  deriveKybCheckStatus,
  resolveKybOnboarding,
} from '../../../../backend/src/shared/models/onboardingDecision';

describe('effectiveDecisionMode (fail-safe default)', () => {
  it('defaults unknown/unset to manual', () => {
    expect(effectiveDecisionMode(undefined)).toBe('manual');
    expect(effectiveDecisionMode({})).toBe('manual');
    expect(effectiveDecisionMode({ decisionMode: 'automated' })).toBe('automated');
    expect(effectiveDecisionMode({ decisionMode: 'assisted' })).toBe('assisted');
  });
});

describe('deriveKycCheckStatus', () => {
  it('rejects on a sanctions hit in any mode', () => {
    expect(deriveKycCheckStatus({ sanctionsResult: 'hit', riskRating: 'low' }, 'automated')).toBe('rejected');
    expect(deriveKycCheckStatus({ sanctionsResult: 'hit' }, 'manual')).toBe('rejected');
  });
  it('rejects on a failed provider verification', () => {
    expect(deriveKycCheckStatus({ verificationStatus: 'fail' }, 'automated')).toBe('rejected');
  });
  it('verifies automated + low risk + no PEP', () => {
    expect(deriveKycCheckStatus({ riskRating: 'low', pepStatus: false, sanctionsResult: 'clear' }, 'automated')).toBe('verified');
  });
  it('stays initiated for manual/assisted even when clean', () => {
    expect(deriveKycCheckStatus({ riskRating: 'low', sanctionsResult: 'clear' }, 'manual')).toBe('initiated');
    expect(deriveKycCheckStatus({ riskRating: 'low', sanctionsResult: 'clear' }, 'assisted')).toBe('initiated');
  });
  it('stays initiated on PEP even automated + low risk', () => {
    expect(deriveKycCheckStatus({ riskRating: 'low', pepStatus: true, sanctionsResult: 'clear' }, 'automated')).toBe('initiated');
  });
  it('maps provider manual_review to initiated (escalate)', () => {
    expect(deriveKycCheckStatus({ verificationStatus: 'manual_review' }, 'automated')).toBe('initiated');
  });
});

describe('deriveKybCheckStatus', () => {
  it('rejects on sanctions hit / fail', () => {
    expect(deriveKybCheckStatus({ sanctionsResult: 'hit' }, 'automated')).toBe('rejected');
    expect(deriveKybCheckStatus({ verificationStatus: 'fail' }, 'automated')).toBe('rejected');
  });
  it('verifies automated + low risk + clean', () => {
    expect(deriveKybCheckStatus({ businessRiskLevel: 'low', sanctionsResult: 'clear', adverseMediaResult: 'clear' }, 'automated')).toBe('verified');
  });
  it('stays initiated when adverse media hit', () => {
    expect(deriveKybCheckStatus({ businessRiskLevel: 'low', adverseMediaResult: 'hit' }, 'automated')).toBe('initiated');
  });
});

describe('resolveKybOnboarding (saga terminal, §5bis.5)', () => {
  it('manual mode always escalates', () => {
    expect(resolveKybOnboarding({ businessRiskLevel: 'low', sanctionsResult: 'clear' }, { decisionMode: 'manual' }).action).toBe('escalate');
    expect(resolveKybOnboarding({ businessRiskLevel: 'low' }, undefined).action).toBe('escalate'); // fail-safe
  });
  it('automated auto-approves low risk clean', () => {
    const r = resolveKybOnboarding({ businessRiskLevel: 'low', sanctionsResult: 'clear', adverseMediaResult: 'clear' }, { decisionMode: 'automated' });
    expect(r.action).toBe('auto_approve');
  });
  it('automated auto-rejects a sanctions hit', () => {
    const r = resolveKybOnboarding({ sanctionsResult: 'hit' }, { decisionMode: 'automated' });
    expect(r.action).toBe('auto_reject');
  });
  it('NEVER auto-approves a PEP hit (hard guardrail)', () => {
    const r = resolveKybOnboarding({ businessRiskLevel: 'low', sanctionsResult: 'clear', pepHit: true }, { decisionMode: 'automated' });
    expect(r.action).toBe('escalate');
  });
  it('automated escalates high risk', () => {
    const r = resolveKybOnboarding({ businessRiskLevel: 'high', sanctionsResult: 'clear' }, { decisionMode: 'automated' });
    expect(r.action).toBe('escalate');
  });
  it('assisted produces a recommendation (HITL), never a terminal decision', () => {
    const r = resolveKybOnboarding({ businessRiskLevel: 'low', sanctionsResult: 'clear' }, { decisionMode: 'assisted' });
    expect(r.action).toBe('recommend');
    if (r.action === 'recommend') expect(r.recommended).toBe('approve');
  });
});
