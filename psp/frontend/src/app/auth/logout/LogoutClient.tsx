'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { logoutSession } from '../../../lib/logout';

/**
 * The authority's browser-facing address, resolved by the server component above this one.
 *
 * A prop and not a `NEXT_PUBLIC_*` constant: those are frozen into the bundle when the image is
 * built, so one image could only ever hold one environment's authority, and the same image promoted
 * from staging to production would send people to the wrong one (it sent them to the localhost dev
 * default). Read at request time instead, the address is whatever the pod is configured with.
 */
/** This console's own registration at the authority, the same one `startSignIn` authorizes as. */
const CONSOLE_CLIENT_ID = 'leafypay-console';

interface LogoutProps {
  authorityUiUrl: string;
  /** The merchant app's public origin, the only other return this page will honour. */
  merchantUrl: string;
  /** An ID token this authority issued to THIS console, when somebody is signed in here. */
  idTokenHint?: string;
}

/**
 * Resolves the post-logout redirect, as the authority's own registration requires it: an absolute
 * URL, exactly one of the ones it holds for some client in this realm.
 *
 * A relative path used to come back unchanged, which was safe against an open redirect (it can only
 * ever mean this same origin) and wrong for a different reason: sent to the authority as
 * `post_logout_redirect_uri`, `/system` is not a parseable absolute URL at all, so the authority's
 * own validation threw, silently dropped it, and the answer carried no redirect back, stranding the
 * browser on the authority's own sign-in page. Registering every deep path this app might ask to
 * return to is not a list that ends; landing on this origin's own registered root once signed out
 * everywhere is the ordinary shape RP-initiated logout takes elsewhere too, and it is what the bank's
 * own equivalent already does.
 */
function safeRedirect(raw: string | null, merchantUrl: string): string {
  if (!raw) return window.location.origin;
  if (/^\/(?![/\\])/.test(raw)) return window.location.origin; // same-origin: land on our own registered root
  try {
    const url = new URL(raw);
    const allowed = new Set<string>([window.location.origin]);
    try { allowed.add(new URL(merchantUrl).origin); } catch { /* ignore bad config */ }
    if ((url.protocol === 'https:' || url.protocol === 'http:') && allowed.has(url.origin)) {
      return url.origin;
    }
  } catch { /* not a parseable URL */ }
  return window.location.origin;
}

// ---------------------------------------------------------------------------
// PSP RP-initiated logout endpoint (OIDC-style front-channel logout).
//
// A relying party (e.g. the merchant app on 8082) cannot clear the PSP portal
// session cookie `demo_token` itself: that cookie lives on the PSP origin (8080).
// The merchant logout therefore redirects the browser HERE so the PSP session is
// terminated same-origin (single sign-out), then bounces back to the RP.
//
// SECURITY: without this, logging out of the merchant left the PSP session alive,
// so a hosted checkout (same origin) still recognised the "logged-in" viewer and
// surfaced their saved cards. Clearing the token here closes that gap.
//
// The shared GIAM session (`giam_session`) is a separate gap: clearing this cookie never touched it,
// so the next authorization request found it still live and skipped sign-in entirely. Ending it needs
// a top-level navigation to the authority (its cookie is SameSite=Lax, a fetch would not carry it),
// so this hop continues there before returning to the RP.
// ---------------------------------------------------------------------------
function LogoutInner({ authorityUiUrl, merchantUrl, idTokenHint }: LogoutProps) {
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Terminate the PSP session: invalidate the token server-side (epoch bump), then clear the
      // same-origin cookie. Both happen before we redirect onward.
      await logoutSession();
      if (cancelled) return;
      const back = safeRedirect(searchParams.get('redirect'), merchantUrl);
      const authority = new URL('/auth/logout', authorityUiUrl);
      authority.searchParams.set('post_logout_redirect_uri', back);
      /**
       * WHOSE sign-out this is, which is not always this console's.
       *
       * A relying party that cannot clear this origin's cookie itself sends the browser here and
       * names itself, because the address it wants to land on is registered to IT and the authority
       * checks a return address against the registration of the client that asked. Relaying that
       * name is honest: the merchant initiated this, and this hop only clears a cookie on the way.
       * Nothing is taken on trust, since the authority still has to find the address in that
       * client's own registration.
       *
       * The hint is only sent for this console's own sign-out: it is this console's token, so it
       * would contradict another client's name, and an ID token has no business travelling through
       * a third party's URL anyway.
       */
      const onBehalfOf = searchParams.get('client_id');
      if (onBehalfOf) {
        authority.searchParams.set('client_id', onBehalfOf);
      } else {
        authority.searchParams.set('client_id', CONSOLE_CLIENT_ID);
        if (idTokenHint) authority.searchParams.set('id_token_hint', idTokenHint);
      }
      window.location.replace(authority.toString());
    })();
    return () => { cancelled = true; };
  }, [searchParams, authorityUiUrl, merchantUrl, idTokenHint]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500 text-sm">Signing you out...</div>
    </div>
  );
}

export default function LogoutClient({ authorityUiUrl, merchantUrl, idTokenHint }: LogoutProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Signing you out...</div>
      </div>
    }>
      <LogoutInner authorityUiUrl={authorityUiUrl} merchantUrl={merchantUrl} idTokenHint={idTokenHint} />
    </Suspense>
  );
}
