import { NextRequest, NextResponse } from 'next/server';
import { completeSignIn } from '../../../../lib/authority';

// The registered redirect for bankcore-console. The authority returns a code here, or an error.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const home = new URL('/', request.nextUrl.origin);

  const error = params.get('error');
  if (error) {
    home.searchParams.set('signin_error', params.get('error_description') ?? error);
    return NextResponse.redirect(home);
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    home.searchParams.set('signin_error', 'The authority returned no code.');
    return NextResponse.redirect(home);
  }

  const result = await completeSignIn(code, state);
  if (!result.ok) home.searchParams.set('signin_error', result.error ?? 'sign_in_failed');
  return NextResponse.redirect(home);
}
