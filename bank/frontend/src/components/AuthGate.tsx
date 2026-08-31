'use client';

import { useEffect, useState } from 'react';

/**
 * The sign-in gate for the bank's back office.
 *
 * The bank's administrative API requires an interactive principal with the right role, so until
 * somebody signs in there is nothing this console can show. Credentials are posted to this app's own
 * route handler and forwarded to the authority; nothing here talks to the bank.
 */

interface RosterEntry {
  subjectId: string;
  userName: string;
  email?: string;
  role?: string;
}

interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
}

// Plaintext behind the seed fixture's credential hashes, so it belongs to the demo data.
const DEMO_PASSWORD = 'demo-password';

const AUTHORITY_UI = process.env.NEXT_PUBLIC_BANKCORE_AUTHORITY_URL ?? 'http://localhost:8085';

function byRole(roster: RosterEntry[]): Array<[string, RosterEntry[]]> {
  const groups = new Map<string, RosterEntry[]>();
  for (const entry of roster) {
    const role = entry.role ?? 'no role assigned';
    const existing = groups.get(role);
    if (existing) existing.push(entry);
    else groups.set(role, [entry]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [debug, setDebug] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  useEffect(() => {
    if (session?.signedIn) return;
    // The roster is the authority's, read straight from it: this console keeps no copy of who exists.
    fetch(`${AUTHORITY_UI}/realms/bankcore/login-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRoster(data?.roster ?? []))
      .catch(() => setRoster([]));
  }, [session?.signedIn]);

  async function submit(credentials: { login: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'That did not work.');
        return;
      }
      setSession({ signedIn: true, userName: body.userName });
    } catch {
      setError('This console could not reach the identity service.');
    } finally {
      setBusy(false);
    }
  }

  if (session === null) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-bank-ink/60">Checking your session…</main>;
  }

  if (session.signedIn) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-bank-ink">BankCore</h1>
          <p className="mt-1 text-sm text-bank-ink/60">Sign in to administer the bank</p>
        </div>

        <form
          onSubmit={(event) => { event.preventDefault(); submit({ login, password }); }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-bank-ink/60" htmlFor="login">
              Email or user name
            </label>
            <input
              id="login"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              className="w-full rounded-md border px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-bank-ink/60" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="w-full rounded-md border px-3 py-2"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy || !login || !password}
            className="w-full rounded-md bg-accent px-4 py-2 font-medium text-bank-ink disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {roster.length > 0 && (
          <div className="mt-8 border-t pt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-bank-ink/40">
                Debug mode: staff by role
              </p>
              <button
                type="button"
                onClick={() => setDebug(!debug)}
                className="text-xs text-bank-ink/60 underline"
              >
                {debug ? 'Hide' : `Show ${roster.length}`}
              </button>
            </div>

            {debug && (
              <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                {byRole(roster).map(([role, entries]) => (
                  <div key={role}>
                    <p className="mb-1 text-xs font-semibold text-bank-ink/70">{role}</p>
                    <div className="grid gap-1">
                      {entries.map((entry) => (
                        <div key={entry.subjectId} className="flex items-center gap-1">
                          {/* Fills the form without signing in, so the credential is visible first. */}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { setLogin(entry.userName); setPassword(DEMO_PASSWORD); }}
                            className="flex-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                          >
                            <span className="block">{entry.userName}</span>
                            {entry.email && <span className="block text-xs text-bank-ink/50">{entry.email}</span>}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title={`Sign in as ${entry.userName}`}
                            onClick={() => {
                              setLogin(entry.userName);
                              setPassword(DEMO_PASSWORD);
                              submit({ login: entry.userName, password: DEMO_PASSWORD });
                            }}
                            className="rounded-md border px-2 py-2 text-xs text-bank-ink/70 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Go
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
