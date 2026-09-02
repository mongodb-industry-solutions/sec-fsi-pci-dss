'use client';

import { useEffect } from 'react';
import { getToken, decodeToken } from '../lib/auth';

/**
 * Keeps the signed-in session alive while somebody is using the app.
 *
 * The access token the authority issues lasts fifteen minutes; a demo lasts hours. Nothing renewed it,
 * so the browser silently stopped being signed in part-way through and every screen that asks "is
 * somebody here" began answering no. On the hosted checkout that showed up as the buyer's saved cards
 * disappearing, which reads as a checkout fault rather than as an expiry.
 *
 * Mounted once at the root so every page inherits it, including the gateway pages a buyer arrives at
 * from a merchant. It only ever renews an existing session: with no token it does nothing at all, so
 * it can never turn an anonymous visitor into a request to the authority.
 */

// Renewed this long before expiry, so a request in flight cannot land on a token that just died.
const RENEW_BEFORE_SECONDS = 120;
const CHECK_EVERY_MS = 60_000;

export function SessionKeeper() {
  useEffect(() => {
    let stopped = false;
    // One renewal at a time: several tabs or a burst of checks must not each rotate the refresh
    // token, because the authority retires the presented one and the losers would then hold a dead
    // credential.
    let inFlight: Promise<void> | null = null;

    async function renewIfDue() {
      const token = getToken();
      if (!token) return;
      const claims = decodeToken(token);
      if (!claims?.exp) return;
      const secondsLeft = claims.exp - Date.now() / 1000;
      if (secondsLeft > RENEW_BEFORE_SECONDS) return;
      if (inFlight) return inFlight;

      inFlight = fetch('/api/auth/refresh', { method: 'POST' })
        .then(() => undefined)
        // A failed renewal needs no handling here: the cookie is either replaced or gone, and the
        // screens read the cookie rather than this result.
        .catch(() => undefined)
        .finally(() => { inFlight = null; });
      return inFlight;
    }

    void renewIfDue();
    const timer = setInterval(() => { if (!stopped) void renewIfDue(); }, CHECK_EVERY_MS);
    // A tab left in the background misses its interval; coming back is exactly when a stale token is
    // about to be used.
    const onVisible = () => { if (document.visibilityState === 'visible') void renewIfDue(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
