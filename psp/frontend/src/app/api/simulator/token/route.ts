import { NextRequest, NextResponse } from 'next/server';
import { personaToken } from '../../../../lib/simulatorCredential';

/**
 * POST returns a real token for a demo persona, for the simulator to act with.
 *
 * Thin on purpose: the credential and the exchange live in lib/simulatorCredential.ts, and the
 * authority is the only thing deciding whether the exchange is allowed.
 */
export async function POST(request: NextRequest) {
  let email: string | undefined;
  try {
    ({ email } = (await request.json()) as { email?: string });
  } catch {
    return NextResponse.json({ error: 'A JSON body with an email is required.' }, { status: 400 });
  }
  if (!email) return NextResponse.json({ error: 'An email is required.' }, { status: 400 });

  const token = await personaToken(email);
  // The authority declines without saying which of its checks stopped it, so neither does this.
  if (!token) return NextResponse.json({ error: `The simulator is not permitted to act as ${email}` }, { status: 403 });
  return NextResponse.json({ access_token: token });
}
