import { api } from './api';
import { DEMO_PASSWORD } from './constants';

// Simulator authentication helper.
//
// The simulator has no login screen, but every action it performs must hit the
// REAL backend with a REAL per-role JWT (no auth bypass). This helper obtains a
// token by calling the same POST /api/v1/auth/login endpoint that application
// mode uses, with the shared demo credential. Tokens are cached per email and
// per role for the lifetime of the page so we don't re-login on every step.

const tokenByEmail = new Map<string, string>();
const emailByRole = new Map<string, string>();

/** Login as a specific demo user and return a real JWT (cached per email). */
export async function getSimToken(email: string): Promise<string> {
  const cached = tokenByEmail.get(email);
  if (cached) return cached;

  const { token } = await api.auth.login({
    email,
    password: DEMO_PASSWORD,
    domain: 'leafypay',
  });
  tokenByEmail.set(email, token);
  return token;
}

/**
 * Resolve a featured demo user for the given role and return a real JWT for it.
 * Used by the simulator to act as L1 / L2 without hardcoding emails.
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
