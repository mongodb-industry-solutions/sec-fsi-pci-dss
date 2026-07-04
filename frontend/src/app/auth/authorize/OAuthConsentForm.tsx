'use client';

import { useState } from 'react';
import { BACKEND_PUBLIC_URL } from '../../../lib/constants';

interface OAuthConsentFormProps {
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  codeChallenge?: string;
  nonce?: string;
  originalSearchParams: Record<string, string>;
}

export default function OAuthConsentForm({
  clientId,
  clientName,
  redirectUri,
  scopes,
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

  return (
    <div className="px-6 py-5 space-y-3">
      <p className="text-sm text-gray-600">
        Allow <span className="font-semibold text-gray-900">{clientName}</span> to access your account?
      </p>
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
