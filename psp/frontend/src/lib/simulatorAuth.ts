import { api } from './api';
import { AUTHORITY_ISSUER_URL, SIMULATOR_CLIENT_ID, SIMULATOR_CLIENT_SECRET } from './constants';

/**
 * Simulator authentication.
 *
 * The simulator has no login screen, but every action it performs hits the real backend with a real
 * per-role token: there is no auth bypass here and never was. What changed is how the token is
 * obtained.
 *
 * It used to sign in as the persona with a password shared by every demo account. That produced a
 * token indistinguishable from the person's own, so the audit trail could not say whether Julia
 * Santos did something or the simulator did it as her. It also meant a working password for every
 * demo identity was compiled into the browser bundle.
 *
 * Now it exchanges its OWN credential for a token that carries an `act` claim naming the simulator.
 * Every simulated action reads as "the simulator, acting as Julia Santos", which is strictly better
 * evidence than what it replaces. The authority refuses the exchange unless the realm is a
 * demonstration realm AND the target is a declared demo persona, so the capability cannot be turned
 * against a real user.
 *
 * The shape of this module is deliberately unchanged: `getSimToken(email)`, the per-role resolution
 * and the cache all behave as before. Only the call underneath is different.
 */

const tokenByEmail = new Map<string, string>();
const emailByRole = new Map<string, string>();

/** The simulator's own token, which is what it exchanges. Cached for the life of the page. */
let ownToken: string | null = null;

async function ownAccessToken(): Promise<string> {
  if (ownToken) return ownToken;
  const response = await fetch(`${AUTHORITY_ISSUER_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SIMULATOR_CLIENT_ID,
      client_secret: SIMULATOR_CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw new Error('The simulator could not authenticate against the identity service');
  const body = await response.json();
  ownToken = body.access_token as string;
  return ownToken;
}

/** A real token for a specific demo persona, carrying the simulator as its actor (cached per email). */
export async function getSimToken(email: string): Promise<string> {
  const cached = tokenByEmail.get(email);
  if (cached) return cached;

  const subjectToken = await ownAccessToken();
  const response = await fetch(`${AUTHORITY_ISSUER_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_subject: email,
      client_id: SIMULATOR_CLIENT_ID,
      client_secret: SIMULATOR_CLIENT_SECRET,
    }),
  });
  if (!response.ok) {
    // The authority declines without saying which of its checks stopped it, so neither does this.
    throw new Error(`The simulator is not permitted to act as ${email}`);
  }
  const body = await response.json();
  const token = body.access_token as string;
  tokenByEmail.set(email, token);
  return token;
}

/**
 * Resolve a featured demo user for the given role and return a real token for it.
 * Used by the simulator to act as a given role without hardcoding emails.
 */
export async function getSimTokenForRole(role: string): Promise<string> {
  let email = emailByRole.get(role);
  if (!email) {
    const { users } = await api.system.users(true);
    const match = users.find((u) => u.role === role);
    if (!match) {
      throw new Error(`No featured demo user found for role "${role}"`);
    }
    email = match.email;
    emailByRole.set(role, email);
  }
  return getSimToken(email);
}
