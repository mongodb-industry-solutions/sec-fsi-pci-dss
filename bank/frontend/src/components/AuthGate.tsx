'use client';

import { useEffect, useState } from 'react';

/**
 * The sign-in gate for the bank's back office.
 *
 * There is no form here on purpose. Credentials are entered at the authority, which hosts the sign-in
 * page and its debug roster for every application; this app only starts the authorization request and
 * receives the code. That is the whole point of having one place that authenticates.
 */

interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('signin_error'));
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  if (session === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-bank-ink/60">
        Checking your session…
      </div>
    );
  }

  if (session.signedIn) return <>{children}</>;

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl border bg-white p-8 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-bank-ink">Sign in required</h2>
        <p className="mt-2 text-sm text-bank-ink/60">
          The bank&apos;s administration is limited to its own staff, by role. You will be asked to
          sign in at the identity authority.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <a
          href="/api/auth/start"
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 font-medium text-bank-ink"
        >
          Sign in
        </a>
      </div>
    </div>
  );
}
