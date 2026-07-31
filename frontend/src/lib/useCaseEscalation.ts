'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { readEscalationToken, storeEscalationToken } from './escalation';

// One place to obtain the per-case L2 escalation token, for every page that renders sensitive
// QE:none data for a case: the case itself, a linked transaction and a linked customer.
//
// The token lives in sessionStorage (per tab), so a deep link opened in a new tab arrives without
// it and the backend correctly returns no sensitive data. When the case is already escalated AND
// accepted, the token is re-derived from the backend, which is idempotent and adds no audit noise:
// the acceptance already happened, this only rebuilds the stateless capability. A case that was
// never accepted stays closed (the endpoint requires `escalated` status and 422s otherwise).

/**
 * May the acting role's escalation token be re-derived for this case? Only an L2, and only when the
 * escalation was already accepted: re-deriving must never turn into approving.
 */
export function canResumeEscalation(
  role: string,
  fraudCase: { caseStatus: string; escalationAcceptedAt?: string | null } | null | undefined,
): boolean {
  if (role !== 'level2_investigator' || !fraudCase) return false;
  return fraudCase.caseStatus === 'escalated' && !!fraudCase.escalationAcceptedAt;
}

export interface CaseEscalation {
  /** Capability token for this case, when the acting L2 holds one. */
  escalationToken?: string;
  /** True while the token is being re-derived. Callers must not render "restricted" yet. */
  resolving: boolean;
  /** Adopt a token obtained by an explicit approve action on the page. */
  adopt: (caseId: string, token: string) => void;
}

interface Options {
  caseId?: string | null;
  role: string;
  /** Acting JWT. Empty until auth is read, which also gates the resume. */
  token: string;
  /** Case state when the page already loaded it, to avoid a second fetch. */
  fraudCase?: { caseStatus: string; escalationAcceptedAt?: string | null } | null;
}

export function useCaseEscalation({ caseId, role, token, fraudCase }: Options): CaseEscalation {
  const [escalationToken, setEscalationToken] = useState<string | undefined>();
  const [resolving, setResolving] = useState(false);
  // Resume once per case, so a 422 (never accepted) is not retried on every render.
  const resumedFor = useRef<string | null>(null);
  const resolveSeq = useRef(0);

  const adopt = useCallback((id: string, value: string) => {
    storeEscalationToken(id, value);
    setEscalationToken(value);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    const persisted = readEscalationToken(caseId);
    if (persisted) setEscalationToken(persisted);
  }, [caseId]);

  useEffect(() => {
    if (!caseId || !token || escalationToken) return;
    if (role !== 'level2_investigator') return;
    if (readEscalationToken(caseId)) return;
    if (resumedFor.current === caseId) return;
    resumedFor.current = caseId;

    // The pending state is owned by a sequence number, not by the effect's cleanup: a torn-down
    // effect (dependency change, or the double invoke in development) must not leave the caller
    // waiting on a resume that did finish.
    const seq = ++resolveSeq.current;
    setResolving(true);
    (async () => {
      try {
        const c = fraudCase ?? await api.fraud.getById(caseId, token);
        if (!canResumeEscalation(role, c)) return;
        const res = await api.fraud.escalateApprove(caseId, {}, token);
        if (seq !== resolveSeq.current) return;
        storeEscalationToken(caseId, res.escalationToken);
        setEscalationToken(res.escalationToken);
      } catch { /* not entitled, or the case is not in an accepted escalation */ } finally {
        if (seq === resolveSeq.current) setResolving(false);
      }
    })();
  }, [caseId, role, token, escalationToken, fraudCase]);

  return { escalationToken, resolving, adopt };
}
