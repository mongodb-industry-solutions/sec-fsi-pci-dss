// POST /api/auth/ciba/start — begin passwordless login (session-less by design: the user is logged out).
// The merchant (confidential client) calls the PSP bc-authorize endpoint with the browser-supplied
// login_hint_token (opaque sub, no raw PII). Returns { auth_req_id, interval, expires_in, binding_message }.
import { NextRequest, NextResponse } from 'next/server';
import { backchannelAuthorize } from '@/lib/oauth';
import { REQUESTED_SCOPES } from '@/lib/env';
import { randomInt } from 'crypto';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { login_hint_token?: string };
  if (!body.login_hint_token) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'login_hint_token required' }, { status: 400 });
  }
  // Short human-verifiable code the user confirms on the Authentication Device (CIBA binding_message).
  const bindingMessage = `Espresso login ${randomInt(1000, 9999)}`;
  try {
    const r = await backchannelAuthorize({
      loginHintToken: body.login_hint_token,
      scope: REQUESTED_SCOPES.join(' '),
      bindingMessage,
    });
    return NextResponse.json({ ...r, binding_message: bindingMessage });
  } catch (e) {
    return NextResponse.json({ error: 'bc_authorize_failed', error_description: (e as Error).message }, { status: 400 });
  }
}
