'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { logoutSession } from '../../../lib/logout';

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
      // Bounce back to the RP's post-logout URL. Only absolute http(s) URLs are honoured
      // (avoids an open-redirect); anything else falls back to the PSP home.
      const raw = searchParams.get('redirect');
      const safe = raw && /^https?:\/\//i.test(raw) ? raw : '/';
      window.location.replace(safe);
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
