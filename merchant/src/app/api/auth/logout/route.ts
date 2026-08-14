// POST/GET /api/auth/logout: revoke tokens at the PSP, clear the local session, then trigger
// single sign-out at the PSP so its portal session (which the hosted checkout reads to surface the
// payer's saved cards) is terminated too. Without the last step, logging out here left the PSP
// session alive and a checkout URL kept showing the "logged-in" viewer's cards (security gap).
import { NextResponse } from 'next/server';
import { revoke } from '@/lib/oauth';
import { clearSessionOn, getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

async function handle() {
  const session = await getSession();
  if (session) {
    // Best-effort revoke: a PSP revoke failure (endpoint unreachable / error) must never block the
    // local logout. Always fall through to clear the session cookie and redirect to single sign-out.
    try {
      if (session.refreshToken) await revoke(session.refreshToken);
      await revoke(session.accessToken);
    } catch { /* ignore: proceed to clear local session regardless */ }
  }
  // Front-channel: bounce the browser through the PSP logout page (clears demo_token same-origin),
  // which then redirects back here. Full navigation (the logout link is a plain <a>), so the PSP
  // page's JS runs.
  const back = new URL('/', ENV.baseUrl()).toString();
  const pspLogout = `${ENV.pspLogoutUrl()}?redirect=${encodeURIComponent(back)}`;
  // Expire the session cookie ON the redirect response: cookies() mutation isn't reliably merged
  // into a returned NextResponse.redirect across Next versions.
  const res = NextResponse.redirect(pspLogout);
  clearSessionOn(res);
  return res;
}

export const GET = handle;
export const POST = handle;
