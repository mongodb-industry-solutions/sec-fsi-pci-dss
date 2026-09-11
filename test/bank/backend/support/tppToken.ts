// A third-party token, obtained the way a third party actually obtains one.
//
// These suites used to mint their own with the bank's issuance service. That service is gone: the
// bank issues nothing now, and a third party gets its token from the identity authority like every
// other principal. A test that mints its own token proves the endpoint under test accepts a token
// the test made up, which is a weaker claim than it looks and stops being true the moment issuance
// moves, as it just did.
//
// So this asks the authority. It is slower and it is the real path.
import { startAuthority, machineToken, type Authority } from './authorityProcess';
import { clientSecretFor } from '@leafypay/platform-links';

/**
 * The SHARED realm (ADR-003). The bank is a client in it, not a directory of its own: what keeps it
 * separate is its own resource server, its own roles and its own token audience.
 */
const REALM = 'leafypay';
/** The registered third parties, so a test can prove one cannot see another's records. */
const CLIENTS: Record<string, string> = {
  'leafypay-psp': clientSecretFor('leafypay-psp'),
  'another-tpp': clientSecretFor('another-tpp'),
};
const DEFAULT_CLIENT = 'leafypay-psp';

let authority: Authority | null = null;
const cached = new Map<string, string>();

/**
 * Starts the authority once for a suite and returns a real machine token.
 *
 * Returns null when the authority cannot be started, so a suite can skip rather than fail with a
 * message about tokens when the actual problem is that nothing is running. A skipped test that says
 * why is more useful than a failing one that misdirects.
 */
export async function tppToken(scopes?: string[], clientId: string = DEFAULT_CLIENT): Promise<string | null> {
  const key = clientId + '|' + (scopes?.join(String.fromCharCode(32)) ?? '*');
  const held = cached.get(key);
  if (held) return held;

  authority ??= await startAuthority();
  if (!authority) return null;

  const secret = CLIENTS[clientId];
  if (!secret) return null;
  const token = await machineToken(authority, REALM, clientId, secret, scopes?.join(String.fromCharCode(32)));
  if (token) cached.set(key, token);
  return token;
}

/** Releases the authority and the cached token, so a following suite starts clean. */
export async function stopTppAuthority(): Promise<void> {
  cached.clear();
  await authority?.stop();
  authority = null;
}
