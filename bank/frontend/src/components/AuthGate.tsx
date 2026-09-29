'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Landing } from './Landing';
import { SESSION_ENDED_EVENT } from '../lib/adminClient';
import { SessionExpired } from './SessionExpired';

/**
 * The sign-in gate for the bank's back office.
 *
 * Signed out, the app shows what it is rather than a bare credential prompt: the landing page carries the
 * one Sign In action. There is no form here on purpose, credentials are entered at the authority, which
 * hosts the one sign-in page every application in the platform uses; this app starts the authorization
 * request and receives the code.
 *
 * The help section is the one exception. It explains the system, its roles and its use of MongoDB, and
 * none of that is back-office data: it is written for whoever is deciding whether to sign in at all, so
 * requiring a session to read it would defeat its own purpose.
 *
 * It also WATCHES the session rather than asking once. It used to check on mount and never again: the
 * layout stays mounted across every navigation in this app, so a token that died mid-session was noticed
 * by nothing. The screen stayed up, actions came back refused, and somebody who had simply been here
 * fifteen minutes was left to work out why. Renewal comes first, because the usual reason is an access
 * token that aged out while the credential behind it is still good; only a refused renewal is the end.
 */
const PUBLIC_PREFIX = '/help';

// Checked this long before expiry, so a request in flight cannot land on a token that just died.
const RENEW_BEFORE_MS = 120_000;
const CHECK_EVERY_MS = 60_000;

interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
  /** Epoch ms the access token expires, so the watcher knows when to renew rather than guessing. */
  expiresAt?: number;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const isPublic = pathname === PUBLIC_PREFIX || pathname.startsWith(`${PUBLIC_PREFIX}/`);

  // Somebody who never signed in is not somebody whose session ended: the landing page is the right
  // answer for them, and the expiry notice would be a lie.
  const wasSignedIn = useRef(false);
  const renewing = useRef<Promise<boolean> | null>(null);

  const readSession = useCallback(async (): Promise<Session> => {
    const response = await fetch('/api/auth/session');
    return await response.json() as Session;
  }, []);

  // One renewal at a time: the authority retires the presented refresh token as it redeems it, so
  // two racing renewals leave the loser holding a dead credential.
  const renew = useCallback(async (): Promise<boolean> => {
    if (!renewing.current) {
      renewing.current = fetch('/api/auth/refresh', { method: 'POST' })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => { renewing.current = null; });
    }
    return renewing.current;
  }, []);

  const check = useCallback(async () => {
    try {
      let current = await readSession();
      const due = !current.signedIn
        || (current.expiresAt !== undefined && current.expiresAt - Date.now() < RENEW_BEFORE_MS);
      if (due && wasSignedIn.current) {
        if (await renew()) current = await readSession();
      }
      if (current.signedIn) {
        wasSignedIn.current = true;
        setExpired(false);
        setSession(current);
        return;
      }
      // Signed out now, and signed in a moment ago: that is an expiry, and it deserves to be named.
      if (wasSignedIn.current) setExpired(true);
      setSession(current);
    } catch {
      setSession({ signedIn: false });
    }
  }, [readSession, renew]);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('signin_error'));
  }, []);

  useEffect(() => {
    if (isPublic) return;
    void check();
    const timer = setInterval(() => { void check(); }, CHECK_EVERY_MS);
    // A tab left in the background misses its interval, and coming back is exactly when a stale
    // token is about to be used.
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    // A call that was refused outright, which is sooner than the next tick and is the moment the
    // person is actually looking at the consequence.
    const onEnded = () => { void check(); };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
    };
  }, [isPublic, pathname, check]);

  if (isPublic) return <>{children}</>;

  if (session === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-gray-500">
        Checking your session…
      </div>
    );
  }

  if (session.signedIn) return <>{children}</>;
  if (expired) return <SessionExpired />;

  // `gated` distinguishes the front door from a deep link somebody followed without a session.
  return <Landing error={error} gated={pathname !== '/'} />;
}
