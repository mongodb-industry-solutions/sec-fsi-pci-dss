import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

/**
 * Runs the identity authority as a real process for the duration of a suite.
 *
 * Not a convenience. Two services cannot both hold an encrypted client in ONE node process: the
 * encryption library is loaded once, and whichever service builds second comes up degraded and
 * answers 503 to everything it would otherwise authorise. Building both in a single test would
 * therefore test the build order rather than the behaviour.
 *
 * Running the authority as a separate process is also how it actually runs, so the bank's verifier
 * does what it does in production: discovery over HTTP, a key set fetched from a URL, and a token it
 * did not mint.
 */
const GIAM_DIR = resolve(__dirname, '../../../../giam/backend');

export interface Authority {
  baseUrl: string;
  stop(): Promise<void>;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // Not up yet. Retrying is the whole point of a readiness wait.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

/**
 * Started on the authority own default port, deliberately.
 *
 * A token carries the issuer recorded on the REALM, not whatever the process was told at startup,
 * so an authority reachable at a different address mints tokens naming an address the resource
 * server does not expect and every verification fails. Matching the seeded issuer is what makes the
 * test exercise verification rather than a URL mismatch.
 */
export async function startAuthority(port = 8085): Promise<Authority | null> {
  const baseUrl = `http://127.0.0.1:${port}`;

  // Already running, which is the common case on a developer machine. Reuse it rather than fighting
  // over the port.
  if (await waitForHealth(baseUrl, 1500)) {
    return { baseUrl, stop: async () => {} };
  }

  const child: ChildProcess = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', 'bin/server.ts'],
    {
      cwd: GIAM_DIR,
      env: { ...process.env, GIAM_PORT: String(port) },
      stdio: 'ignore',
      shell: process.platform === 'win32',
    },
  );

  const ready = await waitForHealth(baseUrl, 90_000);
  if (!ready) {
    child.kill();
    return null;
  }

  return {
    baseUrl,
    async stop() {
      child.kill();
      // A moment to let the port close, so a following suite does not race it.
      await new Promise((done) => setTimeout(done, 300));
    },
  };
}

/** Mints a machine token from the running authority, over HTTP. */
export async function machineToken(
  authority: Authority,
  realm: string,
  clientId: string,
  clientSecret: string,
  scope?: string,
): Promise<string | null> {
  const response = await fetch(`${authority.baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    // A narrower scope than the client holds is how a test proves a scope gate rather than asserting
    // it: the authority issues exactly what was asked for, within what the client is registered for.
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      ...(scope ? { scope } : {}),
    }),
  });
  if (!response.ok) return null;
  return (await response.json() as { access_token: string }).access_token;
}

/** The full interactive flow: sign in, authorize with PKCE, redeem. Exactly as a console does it. */
export async function interactiveToken(
  authority: Authority,
  realm: string,
  login: string,
  password: string,
  clientId: string,
  redirectUri: string,
): Promise<string | null> {
  const { createHash, randomBytes } = await import('crypto');

  const session = await fetch(`${authority.baseUrl}/realms/${realm}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!session.ok) return null;
  const { sessionId } = await session.json() as { sessionId: string };

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authorize = await fetch(`${authority.baseUrl}/realms/${realm}/protocol/openid-connect/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      session_id: sessionId,
    }),
  });
  if (!authorize.ok) return null;
  const { code } = await authorize.json() as { code: string };

  const token = await fetch(`${authority.baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    }),
  });
  if (!token.ok) return null;
  return (await token.json() as { access_token: string }).access_token;
}

export function decodeClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}
