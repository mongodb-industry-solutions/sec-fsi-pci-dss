'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '../../../lib/env';

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

export default function LoginPage() {
  const [context, setContext] = useState<LoginContext | null>(null);
  const [realm, setRealm] = useState(DEFAULT_REALM);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<{ userName?: string; sessionId: string } | null>(null);

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
          <p className="mt-6 text-xs text-gray-400 break-all">session {signedIn.sessionId}</p>
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
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
              Demo personas, one per role
            </p>
            <div className="grid gap-2">
              {context.roster.slice(0, 8).map((entry) => (
                <button
                  key={entry.subjectId}
                  type="button"
                  disabled={busy}
                  onClick={() => submit({ login: entry.userName, password: 'demo-password' })}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span>{entry.userName}</span>
                  {entry.role && <span className="text-xs text-gray-500">{entry.role}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {context?.notice && (
          <p className="mt-6 text-xs text-gray-500">{context.notice}</p>
        )}
      </div>
    </main>
  );
}
