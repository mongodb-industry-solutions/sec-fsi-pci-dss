import { api } from './api';

/**
 * Simulator authentication.
 *
 * The simulator has no login screen, but every action it performs hits the real backend with a real
 * per-role token: there is no auth bypass here and never was. The token carries an `act` claim naming
 * the simulator, so every simulated action reads as "the simulator, acting as Julia Santos", rather
 * than being indistinguishable from something she did herself.
 *
 * The exchange used to happen in this module, in the browser, against the authority directly. That
 * stopped working and should not have been done in the first place. The authority publishes
 * cross-origin access for its own origin only, so the browser blocked the response and no token could
 * be obtained; and the exchange presents a confidential client's secret, which therefore had to be
 * inlined into this bundle, where it was not a secret at all.
 *
 * So the request now goes to this application, same origin, and the credential stays on the server
 * (see lib/simulatorCredential.ts). The shape of this module is deliberately unchanged:
 * `getSimToken(email)`, the per-role resolution and the caches all behave as before.
 */

const tokenByEmail = new Map<string, string>();
const emailByRole = new Map<string, string>();

/** A real token for a specific demo persona, carrying the simulator as its actor (cached per email). */
export async function getSimToken(email: string): Promise<string> {
  const cached = tokenByEmail.get(email);
  if (cached) return cached;

  const response = await fetch('/api/simulator/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({ error: '' })) as { error?: string };
    throw new Error(error || `The simulator is not permitted to act as ${email}`);
  }
  const { access_token: token } = await response.json() as { access_token: string };
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
