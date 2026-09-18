/**
 * Asking the authority who the payer is, without prompting them.
 *
 * The hosted payment pages run on this origin, but a payer who arrived from a merchant was
 * authenticated at the AUTHORITY and holds no session cookie here: the merchant's session lives on
 * the merchant's own origin, encrypted and out of reach, and this app is only a redirect on the way
 * to the authority during that login. So the pages could not tell who was paying, and stopped
 * offering the payer their own cards on file.
 *
 * The fix is an ordinary OpenID Connect authentication request carrying `prompt=none`: the authority
 * answers from the session it already holds, or refuses with `login_required` and nothing changes.
 * The token that comes back is minted for the subject of THIS browser, which is what makes it safe
 * to read cards with. Resolving them from the payment session's stored party instead would hand
 * somebody's cards to anyone who opened the link, since the link is a capability and not a proof of
 * identity.
 *
 * Isomorphic on purpose: the route that starts the flow and the page that decides to start it both
 * read these, and a rule duplicated on both sides is a rule that will come to disagree.
 */

/** The provider route that starts the flow. */
export const SILENT_SIGN_IN_PATH = '/api/auth/silent';

// Written as a code point so no editor or transform can mangle the escape.
const BACKSLASH = String.fromCharCode(92);

/**
 * The only pages the flow may return to.
 *
 * An allowlist rather than a same-origin check: `return_to` is attacker-supplied, and the flow exists
 * for the payment pages alone. Everywhere else a person signs in normally, so accepting other paths
 * would widen what this parameter reaches for no gain.
 */
const RETURN_TO_PREFIXES = ['/gateway/checkout/', '/gateway/pay/'] as const;

/** The return path, or null when it is anything this flow must not send a browser to. */
export function safeReturnTo(raw: string | undefined | null): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  // A browser resolves both of these against the host rather than the path, so they leave this origin.
  if (raw.startsWith('//') || raw.startsWith('/' + BACKSLASH)) return null;
  return RETURN_TO_PREFIXES.some((prefix) => raw.startsWith(prefix)) ? raw : null;
}

export interface SilentSignInConditions {
  /** A session already exists on this origin. */
  hasToken: boolean;
  /** This page is rendered inside a frame. */
  framed: boolean;
  /** This tab has already been through the flow. */
  alreadyAttempted: boolean;
}

export function shouldAttemptSilentSignIn(c: SilentSignInConditions): boolean {
  if (c.hasToken) return false;
  // Once per tab. A payer with no session at the authority comes back refused, and without this the
  // page would ask again on the next render and trap them in a redirect loop.
  if (c.alreadyAttempted) return false;
  // In a frame the authority's session cookie is third-party, so browsers withhold it and the attempt
  // could only fail; its redirect would also land inside the frame rather than in the page.
  if (c.framed) return false;
  return true;
}

export function silentSignInUrl(returnTo: string): string {
  return `${SILENT_SIGN_IN_PATH}?return_to=${encodeURIComponent(returnTo)}`;
}
