// Server-only structured logger for the OIDC/OAuth flow. Emits one JSON line per step with a stable
// `flowId` so an integration can be traced end-to-end and correlated with the PSP audit ledger (the
// backend anchors correlation on hash(state); we log the same `state` alongside our flowId).
//
// Secrets are NEVER logged: tokens, codes, client_secret, Authorization headers and PII are redacted.
// `state`/`nonce` are logged only as a short hash, never raw.
import 'server-only';
import { createHash } from 'crypto';

const SECRET_KEYS = new Set([
  'access_token', 'refresh_token', 'id_token', 'token',
  'code', 'code_verifier', 'authorization_code',
  'client_secret', 'secret', 'password', 'authorization',
  'email', 'phone', 'phone_number', 'state', 'nonce',
]);

// Short, non-reversible tag. Used for `state` so merchant logs join the backend's hash(state) events.
export function shortHash(value?: string): string | undefined {
  if (!value) return undefined;
  return `flow:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) =>
        SECRET_KEYS.has(k.toLowerCase()) ? [k, '[redacted]'] : [k, redact(val)],
      ),
    );
  }
  return v;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, step: string, fields: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, scope: 'oauth', step, ...(redact(fields) as object) };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const oauthLog = {
  info: (step: string, fields: Record<string, unknown> = {}) => emit('info', step, fields),
  warn: (step: string, fields: Record<string, unknown> = {}) => emit('warn', step, fields),
  error: (step: string, fields: Record<string, unknown> = {}) => emit('error', step, fields),
};
