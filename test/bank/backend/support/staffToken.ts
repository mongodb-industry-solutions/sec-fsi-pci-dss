// A bank employee's token, obtained the way an employee actually obtains one.
//
// The administrative surface used to accept a JWT signed with a secret this service and the payment
// service both held. That is gone: a shared symmetric secret means either party can mint a token the
// other accepts, and neither can prove afterwards which one did.
//
// It now takes an ordinary staff token, carrying the permissions the authority resolved, and a test
// that wants one signs in as a real seeded employee and completes the authorization code flow. That
// is slower than minting one and it is the path a person walks.
import { startAuthority, interactiveToken, type Authority } from './authorityProcess';

/**
 * The SHARED realm (ADR-003). The bank is a client in it, not a directory of its own: what keeps it
 * separate is its own resource server, its own roles and its own token audience.
 */
const REALM = 'leafypay';
const CONSOLE_CLIENT = 'bankcore-console';
const REDIRECT_URI = 'http://localhost:8084/api/auth/callback';
const DEMO_PASSWORD = 'demo-password';

/** Seeded employees, by the role each one holds. Named so a test asks for authority, not a person. */
export const STAFF = {
  administrator: 'Samuel Adeyemi',
  compliance: 'Ingrid Larsen',
  operations: 'Marta Oliveira',
  cardOfficer: 'Tomas Reyes',
  accountHolder: 'Elena Duarte',
} as const;

let authority: Authority | null = null;
const cached = new Map<string, string>();

/**
 * A real token for a seeded employee.
 *
 * Returns null when the authority cannot be started, so a suite can skip rather than fail with a
 * message about permissions when the actual problem is that nothing is running.
 */
export async function staffToken(who: keyof typeof STAFF): Promise<string | null> {
  const held = cached.get(who);
  if (held) return held;

  authority ??= await startAuthority();
  if (!authority) return null;

  const token = await interactiveToken(
    authority,
    REALM,
    STAFF[who],
    DEMO_PASSWORD,
    CONSOLE_CLIENT,
    REDIRECT_URI,
  );
  if (token) cached.set(who, token);
  return token;
}

export async function stopStaffAuthority(): Promise<void> {
  cached.clear();
  await authority?.stop();
  authority = null;
}
