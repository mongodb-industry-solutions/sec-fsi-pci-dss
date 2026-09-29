'use client';

import { useEffect } from 'react';
import { getToken, decodeToken, isTokenExpired } from '../lib/auth';
import { endSession, renewSession } from '../lib/session';

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
 *
 * A refused renewal used to be ignored, on the grounds that the cookie is either replaced or gone
 * and the screens read the cookie. They do, but only when they mount: somebody already on a page saw
 * nothing happen, while the header lost their name and each panel that reloaded came back empty. The
 * end of a session is now an event, not an absence.
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
    // Somebody who never signed in is not somebody whose session ended: the gateway pages are
    // reachable anonymously and must be left alone.
    let startedSignedIn = false;

    async function renewIfDue() {
      const token = getToken();
      // Nothing to renew. A token that is already gone while the tab is on an application page is
      // still the end of a session, and saying so is the whole point.
      if (!token) { if (startedSignedIn) endSession(); return; }
      startedSignedIn = true;
      const claims = decodeToken(token);
      if (!claims?.exp) return;
      const secondsLeft = claims.exp - Date.now() / 1000;
      if (secondsLeft > RENEW_BEFORE_SECONDS && !isTokenExpired(token)) return;
      if (inFlight) return inFlight;

      // This one reasons about the expiry it can see: a token already past it that could not be
      // renewed is finished, whatever stopped the renewal. Only a token still alive is given the
      // benefit of the doubt, and then only until it is not.
      inFlight = renewSession()
        .then((outcome) => {
          if (outcome === 'renewed') return;
          if (outcome === 'session_over' || isTokenExpired(getToken() ?? '')) endSession();
        })
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
