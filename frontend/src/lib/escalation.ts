// Per-case escalation token store (per browser tab). The L2 escalation token is a short-lived
// capability the backend issues once when an L2 approves a case escalation. It lives only in
// memory by default, so a page reload or navigating to a linked entity (customer/merchant)
// loses it and the (correctly fail-closed) backend then hides the sensitive QE:none fields.
//
// We persist it in sessionStorage keyed by caseId so an L2 who has approved keeps sensitive
// access while the token is valid and across the case → customer/transaction navigation. The
// token is still validated server-side on every request (expiry enforced there); if it is
// missing or expired the backend simply returns no sensitive data — no fail-open. sessionStorage
// is per-tab and cleared on tab close, appropriate for a short-lived capability token.

const keyFor = (caseId: string) => `esc:${caseId}`;

export function storeEscalationToken(caseId: string, token: string): void {
  if (typeof window === 'undefined' || !caseId || !token) return;
  try { sessionStorage.setItem(keyFor(caseId), token); } catch { /* storage unavailable */ }
}

export function readEscalationToken(caseId: string | null | undefined): string | undefined {
  if (typeof window === 'undefined' || !caseId) return undefined;
  try { return sessionStorage.getItem(keyFor(caseId)) ?? undefined; } catch { return undefined; }
}

export function clearEscalationToken(caseId: string): void {
  if (typeof window === 'undefined' || !caseId) return;
  try { sessionStorage.removeItem(keyFor(caseId)); } catch { /* ignore */ }
}
