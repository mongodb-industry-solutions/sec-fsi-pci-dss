'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { BACKEND_PUBLIC_URL } from '../../../lib/constants';

interface ScopeDescriptor {
  scope: string;
  description: string;
  required: boolean;
}

interface OAuthConsentFormProps {
  clientId: string;
  clientName: string;
  logoUri?: string;
  redirectUri: string;
  scopeDetails: ScopeDescriptor[];
  state?: string;
  codeChallenge?: string;
  nonce?: string;
  originalSearchParams: Record<string, string>;
  /** Demo convenience: prefill values coming from the authorize URL (login_hint / prefill_*). */
  prefillEmail?: string;
  prefillPassword?: string;
}

/** Merchant avatar: logo with a graceful initial-letter fallback if missing or broken. */
export function MerchantAvatar({ logoUri, clientName, size = 'md' }: { logoUri?: string; clientName: string; size?: 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const dim = size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10';
  if (logoUri && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUri}
        alt={`${clientName} logo`}
        onError={() => setBroken(true)}
        className={`${dim} rounded-lg object-contain border border-gray-100 bg-white`}
      />
    );
  }
  return (
    <div className={`${dim} rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-semibold`}>
      {clientName.charAt(0).toUpperCase()}
    </div>
  );
}

export default function OAuthConsentForm({
  clientId,
  clientName,
  logoUri,
  redirectUri,
  scopeDetails,
  state,
  codeChallenge,
  nonce,
  originalSearchParams,
  prefillEmail = '',
  prefillPassword = '',
}: OAuthConsentFormProps) {
  const [view, setView] = useState<'login' | 'consent'>('login');
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState(prefillPassword);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isPrefilled = Boolean(prefillEmail || prefillPassword);
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
      // The /auth/login response exposes the OIDC subject as `sub`; older payloads only carried
      // `customerAuthenticationInstanceReference`. Accept either so `_psp_sub` is always a real UUID.
      const s = data.user.sub ?? data.user.customerAuthenticationInstanceReference;
      setUserSub(s);
      setView('consent');
      // E-10: fetch scopes already granted to this client so we can highlight new permissions.
      try {
        const qs = new URLSearchParams({ ...originalSearchParams, _psp_sub: s });
        const r = await fetch(`${BACKEND_PUBLIC_URL}/api/v1/auth/authorize?${qs.toString()}`, { cache: 'no-store' });
        const d = await r.json();
        const prior: string[] = r.ok && Array.isArray(d.previously_granted_scopes) ? d.previously_granted_scopes : [];
        setPriorScopes(prior);
        // OAuth2/OIDC (RFC 6749 §4.1 + OIDC Core §3.1.2.3): once an active consent grant already
        // covers every requested scope, the authorization server SHOULD NOT re-prompt for consent —
        // re-consent is only required for new/broader scopes (or an explicit prompt=consent). We
        // therefore auto-approve here (equivalent to the user clicking "Allow") instead of showing
        // the scope checkboxes again, so consent is asked once per grant rather than on every login.
        const requested = scopeDetails.map((sc) => sc.scope);
        const allCovered = prior.length > 0 && requested.every((sc) => prior.includes(sc));
        if (allCovered) {
          window.location.href = buildGrantUrl(s, requested);
          return;
        }
      } catch { /* non-fatal: fall back to first-time consent view */ }
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  // Build the "grant" URL. `sub`/`scopes` can be passed explicitly (e.g. the auto-approve path,
  // which runs before the userSub state has committed); otherwise the current form state is used.
  function buildGrantUrl(sub: string = userSub, scopes: string[] = [...selected]) {
    const qs = new URLSearchParams({
      ...originalSearchParams,
      _psp_action: 'grant',
      _psp_sub: sub,
      _psp_scopes: scopes.join(' '), // E-09: send the user's granular selection
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
        {/* Neutral login header. The merchant identity is shown once, in the row above the form. */}
        <div className="text-center mb-5">
          <h2 className="text-base font-semibold text-gray-900">Sign in to your account</h2>
          <p className="text-xs text-gray-500 mt-1">Your password stays with Leafy Pay and is never shared.</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label htmlFor="oauth-email" className="block text-xs font-medium text-gray-700 mb-1">Email / username</label>
            <input
              id="oauth-email"
              type="text"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com or username"
              autoComplete="username"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label htmlFor="oauth-password" className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                id="oauth-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-green-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
              </button>
            </div>
          </div>
          {isPrefilled && (
            <p className="text-[11px] text-amber-600">Demo credentials pre-filled for convenience. You can edit them.</p>
          )}
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
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
