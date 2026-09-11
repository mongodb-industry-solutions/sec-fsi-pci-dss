'use client';
import { api } from './api';
import { getToken, clearToken } from './auth';

// Full PSP portal logout: invalidate the session token SERVER-SIDE (advances the epoch so the
// stateless JWT is rejected even if copied), THEN clear the local cookie. Server invalidation is
// best-effort (a network blip must not block the user from clearing their own browser session).
export async function logoutSession(): Promise<void> {
  const token = getToken();
  if (token) {
    try { await api.auth.logout(token); } catch { /* best-effort: still clear locally below */ }
  }
  // The refresh token is httpOnly, so script cannot reach it. Leaving it behind would let the next
  // renewal sign the person back in after they asked to leave.
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* cleared locally below */ }
  clearToken();
}
