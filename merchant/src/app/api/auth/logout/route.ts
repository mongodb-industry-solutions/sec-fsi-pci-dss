// POST/GET /api/auth/logout — revoke tokens at the PSP, clear the local session, then trigger
// single sign-out at the PSP so its portal session (which the hosted checkout reads to surface the
// payer's saved cards) is terminated too. Without the last step, logging out here left the PSP
// session alive and a checkout URL kept showing the "logged-in" viewer's cards (security gap).
import { NextResponse } from 'next/server';
import { revoke } from '@/lib/oauth';
import { clearSession, getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

async function handle() {
  const session = await getSession();
  if (session) {
    if (session.refreshToken) await revoke(session.refreshToken);
    await revoke(session.accessToken);
  }
  await clearSession();
  // Front-channel: bounce the browser through the PSP logout page (clears demo_token same-origin),
  // which then redirects back here. Full navigation (the logout link is a plain <a>), so the PSP
  // page's JS runs.
  const back = new URL('/', ENV.baseUrl()).toString();
  const pspLogout = `${ENV.pspLogoutUrl()}?redirect=${encodeURIComponent(back)}`;
  return NextResponse.redirect(pspLogout);
}

export const GET = handle;
export const POST = handle;
