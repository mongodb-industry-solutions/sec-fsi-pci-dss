import 'server-only';
import { AUTHORITY_ISSUER_URL, SIMULATOR_CLIENT_ID } from './constants';

/**
 * The simulator's credential, and the exchange it performs, both kept on the server.
 *
 * The simulator has always used a real per-role token, and there was never an auth bypass here. What
 * was wrong is where the exchange ran. It ran in the browser, and that failed on two counts: a
 * confidential client's secret inlined into a bundle is not a secret, which OAuth 2.0 says plainly,
 * and the call could not succeed anyway, because the authority publishes cross-origin access for its
 * own origin only, so the browser blocked the response and the simulator could no longer mint a
 * token at all.
 *
 * Nothing is authorised here. The authority refuses the exchange unless the realm is a demonstration
 * realm AND the subject is a declared demo persona; restating that rule in a second place is how two
 * places come to disagree. This module holds the credential and performs the request.
 */

const TIMEOUT_MS = 10000;

function clientSecret(): string {
  // The operator pin, under the name the authority's seeder reads too: the two must agree, so the
  // variable is shared rather than renamed on one side.
  const pinned = process.env.NEXT_PUBLIC_PSP_SIMULATOR_CLIENT_SECRET?.trim();
  if (pinned) return pinned;

  // Otherwise the demo derivation, from the one function the authority's seeder also uses. Guarded
  // because this image builds from its own directory, so the shared package is not always present;
  // in that case the value arrives through the variable above.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clientSecretFor } = require('@leafypay/platform-links') as {
      clientSecretFor: (clientId: string) => string;
    };
    return clientSecretFor(SIMULATOR_CLIENT_ID);
  } catch {
    // Empty on purpose: the authority declines the flow, which is the right answer for an
    // unconfigured simulator and a clearer failure than a fabricated credential.
    return '';
  }
}

function tokenEndpoint(): string {
  // The private issuer when there is one: this runs server side, so it need not use the origin a
  // browser would be sent to.
  const raw = process.env.PSP_GIAM_ISSUER_URL
    ?? process.env.GIAM_ISSUER_URL
    ?? AUTHORITY_ISSUER_URL;
  return `${raw.replace(/\/+$/, '')}/protocol/openid-connect/token`;
}

async function post(body: URLSearchParams): Promise<string | null> {
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const { access_token: accessToken } = (await response.json()) as { access_token?: string };
  return accessToken ?? null;
}

/**
 * A real token for a demo persona, carrying the simulator as its actor.
 *
 * Two legs, both here. The simulator authenticates as itself, then exchanges that for a token whose
 * subject is the persona and whose `act` claim names the simulator, so every simulated action reads
 * as "the simulator, acting as this person" rather than as the person acting alone.
 */
export async function personaToken(email: string): Promise<string | null> {
  const secret = clientSecret();
  if (!secret) return null;

  try {
    const own = await post(new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SIMULATOR_CLIENT_ID,
      client_secret: secret,
    }));
    if (!own) return null;

    return await post(new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: own,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_subject: email,
      client_id: SIMULATOR_CLIENT_ID,
      client_secret: secret,
    }));
  } catch {
    return null;
  }
}
