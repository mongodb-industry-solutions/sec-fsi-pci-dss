import * as jwt from 'jsonwebtoken';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const JWT_SECRET = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';

export interface EscalationTokenEntry {
  caseId: string;
  issuedToRole: string;
  issuedAt: Date;
  expiresAt: Date;
}

// Escalation tokens are short-lived, case-scoped capability tokens an L2 receives when a case
// escalation is approved. They are issued as SIGNED JWTs (HS256) rather than stored in an
// in-memory map, so they are STATELESS: they survive backend restarts, work across processes,
// and need no server-side store. Validation is a signature + expiry check (synchronous), which
// keeps the many call sites (role clients, transaction/customer reads) unchanged. PCI DSS Req 8
// (authenticated, time-bound access) and Req 7 (need-to-know, case-scoped).
interface EscalationClaims extends jwt.JwtPayload {
  kind: 'escalation';
  caseId: string;
  role: string;
}

export function generateToken(caseId: string, role: string, ttlMs = DEFAULT_TTL_MS): string {
  return jwt.sign(
    { kind: 'escalation', caseId, role } as EscalationClaims,
    JWT_SECRET,
    { expiresIn: Math.floor(ttlMs / 1000) },
  );
}

export function validateToken(token?: string): { valid: boolean; entry?: EscalationTokenEntry } {
  if (!token) return { valid: false };
  try {
    const p = jwt.verify(token, JWT_SECRET) as EscalationClaims;
    if (p.kind !== 'escalation' || !p.caseId) return { valid: false };
    return {
      valid: true,
      entry: {
        caseId: p.caseId,
        issuedToRole: p.role ?? '',
        issuedAt: new Date(((p.iat ?? 0) as number) * 1000),
        expiresAt: new Date(((p.exp ?? 0) as number) * 1000),
      },
    };
  } catch {
    // Invalid signature or expired token → not valid (fail-closed).
    return { valid: false };
  }
}

// Stateless tokens cannot be individually revoked without a denylist; expiry bounds exposure.
// Kept as no-ops for API compatibility with existing call sites.
export function revokeToken(_token: string): void { /* no-op: stateless JWT */ }
export function pruneExpired(): void { /* no-op: expiry is enforced by jwt.verify */ }
export function _clearStore(): void { /* no-op: no in-memory store */ }
