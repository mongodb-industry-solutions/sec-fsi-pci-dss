'use client';

import { useState } from 'react';
import { BACKEND_PUBLIC_URL } from '../../../lib/constants';

interface ScopeDescriptor {
  scope: string;
  description: string;
  required: boolean;
}

interface OAuthConsentFormProps {
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopeDetails: ScopeDescriptor[];
  state?: string;
  codeChallenge?: string;
  nonce?: string;
  originalSearchParams: Record<string, string>;
}

export default function OAuthConsentForm({
  clientId,
  clientName,
  redirectUri,
  scopeDetails,
  state,
  codeChallenge,
  nonce,
  originalSearchParams,
}: OAuthConsentFormProps) {
  const [view, setView] = useState<'login' | 'consent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [userSub, setUserSub] = useState('');
  // Granular selection (E-08): all requested scopes pre-checked; required ones locked on.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scopeDetails.map((s) => s.scope)));
  // Scopes already granted before this request → anything not here is "new" on re-consent (E-10).
  const [priorScopes, setPriorScopes] = useState<string[] | null>(null);

  function toggleScope(scope: string, required: boolean) {
    if (required) return; // required scopes cannot be toggled
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_PUBLIC_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, domain: 'local' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Login failed');
      setUserSub(data.user.sub);
      setView('consent');
      // E-10: fetch scopes already granted to this client so we can highlight new permissions.
      try {
        const qs = new URLSearchParams({ ...originalSearchParams, _psp_sub: data.user.sub });
        const r = await fetch(`${BACKEND_PUBLIC_URL}/api/v1/auth/authorize?${qs.toString()}`, { cache: 'no-store' });
        const d = await r.json();
        if (r.ok && Array.isArray(d.previously_granted_scopes)) setPriorScopes(d.previously_granted_scopes);
      } catch { /* non-fatal: fall back to first-time consent view */ }
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function buildGrantUrl() {
    const qs = new URLSearchParams({
      ...originalSearchParams,
      _psp_action: 'grant',
      _psp_sub: userSub,
      _psp_scopes: [...selected].join(' '), // E-09: send the user's granular selection
    });
    return `${BACKEND_PUBLIC_URL}/api/v1/auth/authorize?${qs.toString()}`;
  }

  function buildDenyUrl() {
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    if (state) redirectUrl.searchParams.set('state', state);
    return redirectUrl.toString();
  }

  if (view === 'login') {
    return (
      <div className="px-6 py-5">
        <p className="text-sm text-gray-600 mb-4">Sign in to your Leafy Pay account to continue</p>
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  // E-10: on re-consent, the scopes not previously granted are the "additional" permissions.
  const isReconsent = priorScopes !== null && priorScopes.length > 0;
  const newScopes = isReconsent ? new Set(scopeDetails.filter((s) => !priorScopes!.includes(s.scope)).map((s) => s.scope)) : new Set<string>();

  return (
    <div className="px-6 py-5 space-y-4">
      {isReconsent && newScopes.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-800">{clientName} is requesting additional permissions</p>
          <p className="text-xs text-amber-700 mt-0.5">Review the new permissions highlighted below before continuing.</p>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">This app will be able to:</p>
        <ul className="space-y-1.5">
          {scopeDetails.map((s) => {
            const isNew = newScopes.has(s.scope);
            return (
              <li
                key={s.scope}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${isNew ? 'bg-amber-50 border border-amber-200' : ''}`}
              >
                <input
                  type="checkbox"
                  id={`scope-${s.scope}`}
                  checked={s.required ? true : selected.has(s.scope)}
                  disabled={s.required}
                  onChange={() => toggleScope(s.scope, s.required)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:opacity-60"
                />
                <label htmlFor={`scope-${s.scope}`} className="text-sm text-gray-700 select-none">
                  {s.description}
                  {s.required && <span className="ml-1 text-xs text-gray-400">(required)</span>}
                  {isNew && <span className="ml-1 text-xs font-medium text-amber-700">(new)</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex gap-3">
        <a
          href={buildGrantUrl()}
          className="flex-1 text-center bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          Allow
        </a>
        <a
          href={buildDenyUrl()}
          className="flex-1 text-center bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm border border-gray-300 transition-colors"
        >
          Deny
        </a>
      </div>
    </div>
  );
}
