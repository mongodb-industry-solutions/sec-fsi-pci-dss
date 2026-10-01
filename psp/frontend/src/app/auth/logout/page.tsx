import { cookies } from 'next/headers';
import LogoutClient from './LogoutClient';

/**
 * Signing out, read from the environment this pod actually runs in.
 *
 * The screen itself has to be a client component: it clears a same-origin session and then leaves
 * for the authority, neither of which a server render can do. What the server contributes is the one
 * value that must not be decided at build time, the authority's own public address.
 */
// Rendered per request, never prerendered: a value read from the environment at build time is the
// very thing this page must not carry.
export const dynamic = 'force-dynamic';

export default async function LogoutPage() {
  // The server-side name first, same convention as PSP_GIAM_ISSUER_URL. The NEXT_PUBLIC one is kept
  // as a fallback because the browser bundle used to be the only place this address lived.
  const authorityUiUrl = process.env.PSP_URL_AUTHORITY_FRONTEND
    ?? process.env.NEXT_PUBLIC_PSP_URL_AUTHORITY_FRONTEND_PUBLIC
    ?? 'http://localhost:8086';
  // The merchant's own address, for the same reason: it decides whether a return there is honoured,
  // and a build-time value would silently drop the merchant's return in any environment it did not
  // match. PSP_MERCHANT_BASE_URL is the merchant's own public base, already configured per pod.
  const merchantUrl = process.env.PSP_MERCHANT_BASE_URL
    ?? process.env.NEXT_PUBLIC_PSP_URL_MERCHANT
    ?? 'http://localhost:8082';
  /**
   * The ID token this session was issued, as `id_token_hint`.
   *
   * Read here and not in the browser because this page's first act is to clear that cookie, and the
   * hint has to be captured before it goes. It is what lets the authority identify the client asking
   * to sign out from something it signed itself, rather than from a name the caller asserts.
   */
  const idToken = (await cookies()).get('demo_identity')?.value;
  return (
    <LogoutClient
      authorityUiUrl={authorityUiUrl}
      merchantUrl={merchantUrl}
      {...(idToken ? { idTokenHint: idToken } : {})}
    />
  );
}
