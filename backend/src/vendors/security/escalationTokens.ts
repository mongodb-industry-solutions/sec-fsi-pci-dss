import { v4 as uuidv4 } from 'uuid';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface EscalationTokenEntry {
  caseId: string;
  issuedToRole: string;
  issuedAt: Date;
  expiresAt: Date;
}

const store = new Map<string, EscalationTokenEntry>();

export function generateToken(caseId: string, role: string, ttlMs = DEFAULT_TTL_MS): string {
  pruneExpired();
  const token = uuidv4();
  const now = new Date();
  store.set(token, {
    caseId,
    issuedToRole: role,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return token;
}

export function validateToken(token?: string): { valid: boolean; entry?: EscalationTokenEntry } {
  if (!token) return { valid: false };
  const entry = store.get(token);
  if (!entry) return { valid: false };
  if (entry.expiresAt < new Date()) {
    store.delete(token);
    return { valid: false };
  }
  return { valid: true, entry };
}

export function revokeToken(token: string): void {
  store.delete(token);
}

export function pruneExpired(): void {
  const now = new Date();
  for (const [token, entry] of store) {
    if (entry.expiresAt < now) store.delete(token);
  }
}

// Exposed for testing only
export function _clearStore(): void {
  store.clear();
}
