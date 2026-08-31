// Real tokens from the identity authority, for the suites that used to mint their own.
//
// This application no longer holds a signing key, so a test cannot mint a token it will accept even
// if it wanted to. That is the point of the extraction, and it lands here as a change in what a test
// can honestly assert: it used to prove the endpoint accepts a token the test made up, and it now
// proves the endpoint accepts a token the authority issued.
//
// The authority is started once and reused across a suite, because starting it is the slow part.
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

// GIAM lives in its own repository now, so its checkout is located rather than assumed.
const REPO_ROOT = resolve(__dirname, '../../../../..');
const GIAM_DIR = resolve(REPO_ROOT, process.env.GIAM_REPO_PATH ?? '../sec-giam', 'backend');
const REALM = 'leafypay';
const DEFAULT_PORT = 8085;

export interface Authority {
  baseUrl: string;
  stop(): Promise<void>;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // Not up yet. Keep waiting until the deadline rather than failing on the first refusal.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

let authority: Authority | null = null;
const cached = new Map<string, string>();

async function start(port = DEFAULT_PORT): Promise<Authority | null> {
  const baseUrl = `http://127.0.0.1:${port}`;

  // Already running, which is the common case on a developer machine. Reuse rather than fight over
  // the port; a stale instance is the caller's problem to notice, not this helper's to guess at.
  if (await waitForHealth(baseUrl, 1500)) {
    return { baseUrl, stop: async () => {} };
  }

  // No local checkout of the authority repository, so there is nothing to spawn: the caller skips.
  if (!existsSync(GIAM_DIR)) return null;

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

  if (!await waitForHealth(baseUrl, 90_000)) {
    child.kill();
    return null;
  }

  return {
    baseUrl,
    async stop() {
      child.kill();
      // A moment for the port to close, so a following suite does not race it.
      await new Promise((done) => setTimeout(done, 300));
    },
  };
}

/**
 * A machine token for a registered client.
 *
 * Returns null when the authority cannot be reached, so a suite can skip with an honest reason
 * rather than fail with a message about authorisation when nothing is running.
 */
export async function authorityToken(
  clientId: string,
  clientSecret: string,
  scopes?: string[],
): Promise<string | null> {
  const key = `${clientId}|${scopes?.join(' ') ?? '*'}`;
  const held = cached.get(key);
  if (held) return held;

  authority ??= await start();
  if (!authority) return null;

  const response = await fetch(`${authority.baseUrl}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
    }),
  });
  if (!response.ok) return null;

  const token = (await response.json() as { access_token?: string }).access_token ?? null;
  if (token) cached.set(key, token);
  return token;
}

export async function stopAuthority(): Promise<void> {
  cached.clear();
  await authority?.stop();
  authority = null;
}
