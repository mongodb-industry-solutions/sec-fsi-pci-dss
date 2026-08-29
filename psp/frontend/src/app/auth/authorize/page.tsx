import { redirect } from 'next/navigation';
import { AUTHORITY_UI_PUBLIC_URL } from '../../../lib/constants';

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
  redirect(`${AUTHORITY_UI_PUBLIC_URL}/auth/login${query ? `?${query}` : ''}`);
}
