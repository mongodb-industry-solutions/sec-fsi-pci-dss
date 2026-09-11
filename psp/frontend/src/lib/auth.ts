'use client';

/**
 * Who is signed in, read from the tokens the identity authority issued.
 *
 * Two cookies, because OIDC separates two questions. `demo_token` is the ACCESS token, the bearer
 * every API call carries; it says what the holder may do. `demo_identity` is the ID token, and it is
 * the only one that says who they are: the access token deliberately carries no name and no email,
 * per RFC 9068, so a resource server never receives personal data it has no use for.
 *
 * Everything here is UNVERIFIED and decides only what the screen renders. Every authorisation
 * decision belongs to the backend, against the same access token, and it checks the signature.
 */

const COOKIE_NAME = 'demo_token';
const IDENTITY_COOKIE_NAME = 'demo_identity';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function getToken(): string | undefined {
  return readCookie(COOKIE_NAME);
}

/**
 * Replaces the access token in place, keeping the identity cookie: a reissued token does not change
 * who the person is.
 *
 * Only caller is the profile password form, which posts to an endpoint this service no longer has
 * (credentials moved to the authority in v39). Kept so that orphan is one fix rather than two.
 */
export function setToken(token: string) {
  const maxAge = 60 * 60 * 24;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; path=/; SameSite=Lax`;
}

export function clearToken() {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`;
  document.cookie = `${IDENTITY_COOKIE_NAME}=; Max-Age=0; path=/`;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
  domain: string;
  partyRef?: string;   // account holder reference; present for users with a Party record
  iat: number;
  exp: number;
}

/** The claims of a JWT, without verifying it. Null when it is not a JWT at all. */
function claimsOf(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/**
 * The authority's claim names, mapped to the shape this application reads.
 *
 * The mapping is here and nowhere else on purpose: nearly forty screens read `user.role` and
 * `user.name`, and translating the authority's vocabulary at each of them is how they come to
 * disagree. A claim the authority does not send resolves to an empty string rather than undefined,
 * because the callers treat these as strings and one of them called `.split` on it.
 */
export function decodeToken(token: string): TokenPayload | null {
  const access = claimsOf(token);
  if (!access) return null;

  const identity = claimsOf(readCookie(IDENTITY_COOKIE_NAME) ?? '') ?? {};

  // `roles` is an array: a person may hold several, and the screens are built around one. The first
  // is the authority's own order, which is the order the roster presents them in.
  const roles = Array.isArray(access.roles) ? (access.roles as unknown[]).map(String) : [];
  // The realm, which is what this application has always called the domain. Parsed from the issuer
  // because the token names the realm nowhere else.
  const issuer = typeof access.iss === 'string' ? access.iss : '';
  const realm = issuer.split('/realms/')[1]?.split('/')[0] ?? '';

  const name = identity.name ?? identity.preferred_username ?? access.preferred_username;
  const email = identity.email ?? access.email;

  return {
    sub: String(access.sub ?? ''),
    email: typeof email === 'string' ? email : '',
    role: roles[0] ?? '',
    // Falls back to the email, then to a neutral label: a greeting reading "Welcome, " is a worse
    // failure than one reading the address the person signed in with.
    name: typeof name === 'string' && name ? name : (typeof email === 'string' ? email : 'Signed in'),
    domain: realm,
    ...(typeof access.account_holder === 'string' ? { partyRef: access.account_holder } : {}),
    iat: Number(access.iat ?? 0),
    exp: Number(access.exp ?? 0),
  };
}

export function isTokenExpired(token: string): boolean {
  const claims = claimsOf(token);
  if (!claims || typeof claims.exp !== 'number') return true;
  return Date.now() / 1000 > claims.exp;
}
