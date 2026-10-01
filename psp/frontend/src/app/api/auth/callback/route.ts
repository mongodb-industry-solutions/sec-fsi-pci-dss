import { NextRequest, NextResponse } from 'next/server';
import { appPublicBase, completeSignIn, consumeReturnTo } from '../../../../lib/authority';

// The registered redirect for leafypay-console. The authority returns a code here, or an error.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get('state');
  // Where this attempt asked to land. Only the silent flow stores one; an ordinary sign-in lands on
  // the console. Consumed first so a refusal below still clears it.
  const returnTo = state ? await consumeReturnTo(state) : null;
  // This app's CONFIGURED public origin, not the one in the request. Behind an ingress the host
  // reaching the pod is not the host the browser used, and deriving the landing page from it sent
  // people to the container's own address (localhost:8080/system) after a perfectly good sign-in.
  // It is also the origin the authority holds as this client's redirect target, so the two agree.
  const home = new URL(returnTo ?? '/system', appPublicBase());

  const error = params.get('error');
  if (error) {
    /**
     * `login_required` is the silent flow's ordinary answer, not a failure.
     *
     * It means the authority holds no session for this browser, so the payer stays anonymous and the
     * page offers the new-card form. Reporting it would turn "nobody is signed in" into an error
     * banner on a working checkout.
     */
    if (returnTo && error === 'login_required') return NextResponse.redirect(home);
    home.searchParams.set('signin_error', params.get('error_description') ?? error);
    return NextResponse.redirect(home);
  }

  const code = params.get('code');
  if (!code || !state) {
    home.searchParams.set('signin_error', 'The authority returned no code.');
    return NextResponse.redirect(home);
  }

  const result = await completeSignIn(code, state);
  if (!result.ok) home.searchParams.set('signin_error', result.error ?? 'sign_in_failed');
  return NextResponse.redirect(home);
}
