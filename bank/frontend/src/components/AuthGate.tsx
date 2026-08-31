'use client';

import { useEffect, useState } from 'react';

/**
 * The sign-in gate for the bank's back office.
 *
 * There is no form here on purpose. Credentials are entered at the authority, which hosts the one
 * sign-in page every application in the platform uses; this app starts the authorization request and
 * receives the code. Having a second form would mean a second place credentials are handled.
 *
 * The card matches that page so the two read as one product. Text colours are stated explicitly
 * rather than inherited: `--bank-ink` is white, which is correct on the dark header and unreadable on
 * a white card, and inheriting it here is what produced white-on-white.
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
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-gray-500">
        Checking your session…
      </div>
    );
  }

  if (session.signedIn) return <>{children}</>;

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-6 text-center">
          <img src="/app-icon.png" alt="BankCore" className="mx-auto h-20 w-20" />
          <h1 className="mt-2 text-2xl font-bold text-[#001E2B]">BankCore</h1>
          <p className="mt-1 text-sm text-gray-500">Application Mode: Sign In</p>
        </div>

        <p className="text-sm text-gray-600">
          The bank&apos;s administration is limited to its own staff, and what you can reach depends on
          the role you hold. You will sign in at the identity authority, which is the only place on
          this platform that accepts a credential.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <a
          href="/api/auth/login"
          className="mt-6 block w-full rounded-lg bg-[#001E2B] py-2.5 text-center font-semibold text-[#00ED64] transition-colors hover:bg-[#00ED64] hover:text-[#001E2B]"
        >
          Sign In
        </a>

        <p className="mt-4 text-center text-xs text-gray-600">
          You will be returned here once you are signed in.
        </p>
      </div>
    </div>
  );
}
