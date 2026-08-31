import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '../../../../lib/authority';

// Credentials are posted here and forwarded to the authority; they never reach the bank's own API.
export async function POST(request: NextRequest) {
  const { login, password } = await request.json().catch(() => ({})) as {
    login?: string; password?: string;
  };
  if (!login || !password) {
    return NextResponse.json({ error: 'A user name and a password are required.' }, { status: 400 });
  }

  const result = await signIn(login, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  return NextResponse.json({ userName: result.userName ?? login });
}
