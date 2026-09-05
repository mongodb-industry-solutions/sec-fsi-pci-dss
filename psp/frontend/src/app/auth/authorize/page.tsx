import { redirect } from 'next/navigation';
import { AUTHORITY_ISSUER_URL } from '../../../lib/constants';

/**
 * Sign-in and consent moved to the identity authority. This is the redirect that keeps the old
 * address working.
 *
 * A client that was built against this URL, and a bookmark, both keep working: every query parameter
 * is preserved, so the authorization request arrives at the authority exactly as it was made. The
 * consent form itself is not here any more, and it should not be: an application that renders the
 * consent screen is an application the user is trusting to describe what they are agreeing to.
 *
 * It goes when the last client repoints, and not before.
 *
 * IT NOW POINTS AT THE AUTHORIZATION ENDPOINT, not at the authority's sign-in page.
 *
 * That was the right target while the authority's console owned the flow and read `client_id`,
 * `redirect_uri` and the rest straight out of its own URL. GIAM v41 made the authorization endpoint
 * conforming, and the console became an ordinary client of it: the endpoint holds the pending
 * request and sends the browser to sign in carrying only a `request_id`. So a request arriving at
 * the sign-in page with raw OAuth parameters now reads as "somebody opened the sign-in page", and
 * the person would be signed in and left standing there with no way back to the application, which
 * is precisely the failure this redirect exists to prevent.
 *
 * Sending them to the endpoint is also the smaller coupling: this page no longer needs to know which
 * route the authority's console serves its login on.
 */

interface AuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) forwarded.append(key, entry);
  }
  const query = forwarded.toString();
  const issuer = AUTHORITY_ISSUER_URL.replace(/\/+$/, '');
  redirect(`${issuer}/protocol/openid-connect/auth${query ? `?${query}` : ''}`);
}
