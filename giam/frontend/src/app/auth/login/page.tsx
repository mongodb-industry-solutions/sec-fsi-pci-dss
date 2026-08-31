'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '../../../lib/env';
import { tokenFromSession } from '../../../lib/session';

/**
 * The sign-in screen.
 *
 * It renders the REALM's branding rather than this console's, which is how the page a relying
 * party's user sees is visually that relying party's page without this console becoming that
 * application. Every product that federates does it this way, and the alternative, letting each
 * application collect the credential, is precisely what the extraction exists to stop.
 *
 * The demo roster and one-click sign-in come with it. They are load bearing for this product: a
 * demonstration runs on signing in as a chosen persona in one click, and moving the login to the
 * authority without bringing them would preserve the security model and break the demonstration.
 */

interface Provider {
  name: string;
  displayName: string;
  protocol: string;
  enabled: boolean;
  notice?: string;
}

interface RosterEntry {
  subjectId: string;
  userName: string;
  email?: string;
  role?: string;
}

interface LoginContext {
  realm: string;
  displayName: string;
  notice?: string;
  registrationEnabled: boolean;
  branding: { displayName: string; logoUri?: string; primaryColor?: string };
  providers: Provider[];
  roster: RosterEntry[];
}

const DEFAULT_REALM = 'leafypay';

// Plaintext behind the seed fixture's credential hashes, so it belongs to the demo data.
const DEMO_PASSWORD = 'demo-password';

/** Personas grouped by the role they hold, so the screen offers a ready-made user per role. */
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

export default function LoginPage() {
  const [context, setContext] = useState<LoginContext | null>(null);
  const [realm, setRealm] = useState(DEFAULT_REALM);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<{ userName?: string; sessionId: string } | null>(null);
  const [showRoster, setShowRoster] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/realms/${realm}/login-context`))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled) setContext(data); })
      .catch(() => { if (!cancelled) setContext(null); });
    return () => { cancelled = true; };
  }, [realm]);

  async function submit(credentials: { login: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/realms/${realm}/login`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        // One message for every failure. Distinguishing an unknown principal from a wrong password
        // is an enumeration oracle, and the person signing in cannot act on the difference anyway.
        setError('That did not work. Check the details and try again.');
        return;
      }
      const body = await response.json();
      // The console then obtains a token for itself the ordinary way, so the screens that need one
      // work. A failure here does not undo the sign-in: the person IS signed in.
      await tokenFromSession(realm, body.sessionId);
      setSignedIn({ userName: body.userName, sessionId: body.sessionId });
    } catch {
      setError('The identity service could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  const accent = context?.branding.primaryColor ?? '#00ED64';

  if (signedIn) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-xl border bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-mongodb-dark">Signed in</h1>
          <p className="mt-2 text-gray-600">{signedIn.userName}</p>
          <div className="mt-6 flex justify-center gap-4 text-sm">
            <a href="/profile/credentials" className="underline">Your authenticators</a>
            <a href="/auth/logout" className="underline">Sign out</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-mongodb-dark">
            {context?.branding.displayName ?? context?.displayName ?? 'Sign in'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>
        </div>

        {context && context.providers.length > 0 && (
          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="realm-picker">
              Directory
            </label>
            <select
              id="realm-picker"
              value={realm}
              onChange={(event) => setRealm(event.target.value)}
              className="w-full rounded-md border px-3 py-2"
            >
              <option value={context.realm}>{context.displayName}</option>
              {context.providers.map((provider) => (
                <option key={provider.name} value={context.realm} disabled={!provider.enabled}>
                  {provider.displayName}
                  {provider.enabled ? '' : ' (not active in this build)'}
                </option>
              ))}
            </select>
          </div>
        )}

        <form
          onSubmit={(event) => { event.preventDefault(); submit({ login, password }); }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="login">
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
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="password">
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
            disabled={busy}
            style={{ backgroundColor: accent }}
            className="w-full rounded-md px-4 py-2 font-medium text-mongodb-dark disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {context && context.roster.length > 0 && (
          <div className="mt-8 border-t pt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Demo personas, by role
              </p>
              <button
                type="button"
                onClick={() => setShowRoster(!showRoster)}
                className="text-xs text-gray-500 underline"
              >
                {showRoster ? 'Hide' : `Show ${context.roster.length}`}
              </button>
            </div>

            {showRoster && (
              <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                {byRole(context.roster).map(([role, entries]) => (
                  <div key={role}>
                    <p className="mb-1 text-xs font-semibold text-gray-600">{role}</p>
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
                            {entry.email && (
                              <span className="block text-xs text-gray-500">{entry.email}</span>
                            )}
                          </button>
                          {/* And the one-click path the booth demonstration runs on, kept. */}
                          <button
                            type="button"
                            disabled={busy}
                            title={`Sign in as ${entry.userName}`}
                            onClick={() => {
                              setLogin(entry.userName);
                              setPassword(DEMO_PASSWORD);
                              submit({ login: entry.userName, password: DEMO_PASSWORD });
                            }}
                            className="rounded-md border px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
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

        {context?.notice && (
          <p className="mt-6 text-xs text-gray-500">{context.notice}</p>
        )}
      </div>
    </main>
  );
}
