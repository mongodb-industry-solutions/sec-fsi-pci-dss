// POST/GET /api/auth/logout — revoke tokens at the PSP and clear the local session.
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
  return NextResponse.redirect(new URL('/', ENV.baseUrl()));
}

export const GET = handle;
export const POST = handle;
