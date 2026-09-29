'use client';
import { clearToken, getToken } from './auth';

/**
 * What happens when the session ends while somebody is using the application.
 *
 * Renewal already existed (see components/SessionKeeper) and a refused renewal was deliberately
 * ignored: "the cookie is either replaced or gone, and the screens read the cookie". The screens do
 * read the cookie, but only when they mount. Somebody already on a page kept looking at it, the
 * header degraded to a nameless "Signed in", every panel that reloaded came back empty or errored,
 * and whatever content was already on screen stayed there reading like a fault in the system. An
 * expiry is an ordinary event and it should look like one: the session ends, and the person is told.
 *
 * Two things happen here and nowhere else, so they cannot disagree: one renewal at a time, and one
 * ending.
 */

const SIGN_IN_PATH = '/system';

/** The query the sign-in page reads to explain, once, why somebody is looking at it. */
export const EXPIRED_QUERY = 'session';
export const EXPIRED_REASON = 'expired';

/**
 * What a renewal attempt actually established.
 *
 * `renewed` and `session_over` are answers. `unavailable` is the absence of one, and the difference
 * matters: only the authority refusing the credential proves the session is finished. Nothing to
 * renew WITH, or no way to ask, proves nothing, and acting on either would sign somebody out over a
 * network blink or over a single route that answered 401 for a reason of its own.
 */
export type RenewOutcome = 'renewed' | 'session_over' | 'unavailable';

let renewal: Promise<RenewOutcome> | null = null;
let ended = false;

/**
 * Renews the access token from the refresh token, at most once at a time.
 *
 * Shared, because the authority retires the refresh token as it redeems it: two renewals racing
 * means the loser holds a dead credential and ends a session that was perfectly alive.
 */
export function renewSession(): Promise<RenewOutcome> {
  if (renewal) return renewal;
  renewal = fetch('/api/auth/refresh', { method: 'POST' })
    .then(async (response): Promise<RenewOutcome> => {
      if (response.ok) return 'renewed';
      const { reason } = await response.json().catch(() => ({})) as { reason?: string };
      // The authority looked at the credential and said no. Anything else (no refresh token to
      // present, an authority that could not be reached) leaves the question open.
      return reason === 'refresh_refused' || reason === 'no_token' ? 'session_over' : 'unavailable';
    })
    .catch((): RenewOutcome => 'unavailable')
    .finally(() => { renewal = null; });
  return renewal;
}

/**
 * Ends the session and takes the person somewhere that makes sense.
 *
 * Only the application shell is sent to sign in. The hosted payment pages are mounted under the same
 * root and are reachable by a payer who never signed in here at all: they already render correctly
 * for somebody anonymous, and redirecting them out of a checkout they are mid-way through would be a
 * worse fault than the one this fixes.
 *
 * Idempotent, because a page that fires several requests gets several refusals, and the first one is
 * the only one worth acting on.
 */
export function endSession(): void {
  if (typeof window === 'undefined' || ended) return;
  ended = true;
  clearToken();
  // The refresh token is httpOnly, so script cannot clear it. Leaving it would sign the person back
  // in on the next load without them asking.
  void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});

  const path = window.location.pathname;
  if (!path.startsWith(`${SIGN_IN_PATH}/`)) return;
  window.location.replace(`${SIGN_IN_PATH}?${EXPIRED_QUERY}=${EXPIRED_REASON}`);
}

/**
 * A refusal aimed at the session the browser is holding, rather than at the request.
 *
 * `401` is the authority saying it does not know who this is, and only when the call carried the
 * SESSION token: the simulator acts with tokens minted for a demo persona, and a refusal of one of
 * those says nothing about whoever is operating the browser. `403` is a different answer entirely,
 * "we know you and you may not", and ending the session over one would throw somebody out for
 * opening a page their role does not cover.
 */
export function isSessionRefusal(status: number, sentToken: string | undefined): boolean {
  if (status !== 401 || !sentToken) return false;
  return sentToken === getToken();
}
