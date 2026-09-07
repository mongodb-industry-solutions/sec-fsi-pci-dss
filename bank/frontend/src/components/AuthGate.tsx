'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Landing } from './Landing';

/**
 * The sign-in gate for the bank's back office.
 *
 * Signed out, the app shows what it is rather than a bare credential prompt: the landing page carries the
 * one Sign In action. There is no form here on purpose, credentials are entered at the authority, which
 * hosts the one sign-in page every application in the platform uses; this app starts the authorization
 * request and receives the code.
 */

interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('signin_error'));
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  if (session === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-gray-500">
        Checking your session…
      </div>
    );
  }

  if (session.signedIn) return <>{children}</>;

  // `gated` distinguishes the front door from a deep link somebody followed without a session.
  return <Landing error={error} gated={pathname !== '/'} />;
}
