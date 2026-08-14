'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { logoutSession } from '../../../lib/logout';
import { MERCHANT_PUBLIC_URL } from '../../../lib/constants';

// Resolve the post-logout redirect safely. Allowing any absolute http(s) URL is an open redirect
// (?redirect=https://evil.example). Permit only: (1) a same-origin relative path (single leading '/',
// not '//' or '/\' protocol-relative/backslash tricks), or (2) an absolute URL whose origin is on the
// allowlist: the PSP itself plus known relying parties (the merchant demo app). Anything else → home.
function safeRedirect(raw: string | null): string {
  if (!raw) return '/';
  if (/^\/(?![/\\])/.test(raw)) return raw; // same-origin relative path
  try {
    const url = new URL(raw);
    const allowed = new Set<string>([window.location.origin]);
    try { allowed.add(new URL(MERCHANT_PUBLIC_URL).origin); } catch { /* ignore bad config */ }
    if ((url.protocol === 'https:' || url.protocol === 'http:') && allowed.has(url.origin)) {
      return url.toString();
    }
  } catch { /* not a parseable URL */ }
  return '/';
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
// ---------------------------------------------------------------------------
function LogoutInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Terminate the PSP session: invalidate the token server-side (epoch bump), then clear the
      // same-origin cookie. Both happen before we redirect back to the RP.
      await logoutSession();
      if (cancelled) return;
      // Bounce back to the RP's post-logout URL, restricted to same-origin paths + an allowlist of
      // known RP origins (see safeRedirect) so ?redirect= cannot be abused as an open redirect.
      window.location.replace(safeRedirect(searchParams.get('redirect')));
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500 text-sm">Signing you out...</div>
    </div>
  );
}

export default function LogoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Signing you out...</div>
      </div>
    }>
      <LogoutInner />
    </Suspense>
  );
}
