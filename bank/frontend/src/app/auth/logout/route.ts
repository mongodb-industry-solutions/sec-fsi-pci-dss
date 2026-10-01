import { NextResponse } from 'next/server';
import { signOut, authorityUiPublic, appPublicBase, consoleClientId } from '../../../lib/authority';

/**
 * Sign out everywhere, not just this app.
 *
 * A browser navigation, not a fetch: the identity console's session cookie is what ends the
 * session every application here shares, and that cookie only travels on a request to the
 * console's own origin, which only a real navigation makes. This app's own session is cleared
 * first, unconditionally, so a person is signed out of THIS browser even if the console cannot be
 * reached; the console then ends the shared session and returns the browser to `appPublicBase()`,
 * the one address this client is registered to be sent back to.
 */
export async function GET() {
  await signOut();
  const target = new URL('/auth/logout', authorityUiPublic());
  target.searchParams.set('post_logout_redirect_uri', appPublicBase());
  // Which client is asking. The authority holds the address above against THIS registration and no
  // other, so saying who is asking is what makes the return address verifiable rather than a name
  // in a shared pool.
  target.searchParams.set('client_id', consoleClientId());
  return NextResponse.redirect(target);
}
