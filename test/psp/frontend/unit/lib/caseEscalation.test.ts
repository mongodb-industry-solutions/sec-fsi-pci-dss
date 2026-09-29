/**
 * Unit tests: frontend/src/lib/useCaseEscalation.ts (canResumeEscalation)
 *
 * The escalation token is a per-tab capability, so a deep link into a case, its transaction or its
 * customer arrives without it and the sensitive fields read as "restricted" for an L2 who is in fact
 * entitled. The resume closes that gap, and this predicate is the guard that keeps it from becoming
 * an approval: re-derive only for an L2, and only when the escalation was already accepted.
 */
import { describe, it, expect } from 'vitest';
import { canResumeEscalation } from '../../../../../psp/frontend/src/lib/useCaseEscalation';

const accepted = { caseStatus: 'escalated', escalationAcceptedAt: '2026-07-30T10:00:00Z' };

describe('canResumeEscalation', () => {
  it('resumes for an L2 on an accepted escalation', () => {
    expect(canResumeEscalation('level2_investigator', accepted)).toBe(true);
  });

  it('never resumes an escalation that was not accepted', () => {
    expect(canResumeEscalation('level2_investigator', { caseStatus: 'escalated' })).toBe(false);
    expect(canResumeEscalation('level2_investigator', { caseStatus: 'escalated', escalationAcceptedAt: null })).toBe(false);
  });

  it('never resumes on a case that is not escalated', () => {
    for (const caseStatus of ['open', 'under_review', 'resolved_cleared', 'closed']) {
      expect(canResumeEscalation('level2_investigator', { ...accepted, caseStatus })).toBe(false);
    }
  });

  it('is an L2 capability: no other role resumes it', () => {
    for (const role of ['level1_analyst', 'security_auditor', 'operations_officer', 'manager', 'customer']) {
      expect(canResumeEscalation(role, accepted)).toBe(false);
    }
  });

  it('is fail-closed without a case', () => {
    expect(canResumeEscalation('level2_investigator', null)).toBe(false);
    expect(canResumeEscalation('level2_investigator', undefined)).toBe(false);
  });
});
