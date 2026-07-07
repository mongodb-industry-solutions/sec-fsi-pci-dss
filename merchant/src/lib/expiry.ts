// Shared OAuth token-expiry helper (server-only). Extracted so both PspClient and the
// process-level token cache can use it without a circular import.
import 'server-only';

// Default access-token lifetime (seconds) when the PSP omits/zeros `expires_in`.
// Without this guard `expiresAt` becomes NaN/past, so the token reads as perpetually
// "near expiry" and every render triggers a refresh (churn).
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

/** Compute a sane epoch-ms expiry from an OAuth `expires_in` (seconds). */
export function expiresAtFrom(expiresIn: unknown): number {
  const s = Number(expiresIn);
  const ttl = Number.isFinite(s) && s > 0 ? s : DEFAULT_TOKEN_TTL_SECONDS;
  return Date.now() + ttl * 1000;
}
