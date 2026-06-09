'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, AuthUser, AuthDomain } from '../../lib/api';
import { Eye, EyeOff } from 'lucide-react';
import { setToken, decodeToken } from '../../lib/auth';
import { DEMO_USERS_PASSWORDS, ROLE_LABELS } from '../../lib/constants';
import { Tooltip } from '../../components/Tooltip';

const ROLE_REDIRECTS: Record<string, string> = {
  customer: '/demo/payment/history',
  level1_analyst: '/demo/investigation',
  level2_investigator: '/demo/investigation',
  security_auditor: '/demo/audit',
};

const FLOW_TYPE_LABELS: Record<string, string> = {
  client_credentials: 'Client Credentials',
  authorization_code: 'Authorization Code (OIDC)',
  saml: 'SAML 2.0',
  oidc: 'OIDC',
};

const FLOW_TYPE_COLORS: Record<string, string> = {
  client_credentials: 'bg-gray-100 text-gray-600',
  authorization_code: 'bg-blue-100 text-blue-700',
  saml: 'bg-purple-100 text-purple-700',
  oidc: 'bg-blue-100 text-blue-700',
};

export default function DemoLoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [domains, setDomains] = useState<AuthDomain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('local');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state on every mount so the router cache never restores stale
  // credentials from a previous session (causes hydration mismatch on the
  // disabled button when the cached render had the form filled in).
  useEffect(() => {
    setSelectedEmail('');
    setPassword('');
    setSubmitting(false);
    setError(null);
  }, []);

  useEffect(() => {
    api.system.users().then((res) => setUsers(res.users)).catch(() => {
      api.auth.users().then((res) => setUsers(res.users)).catch(() => {});
    });
    api.auth.domains()
      .then((res) => {
        setDomains(res.domains);
        if (res.domains.length > 0) setSelectedDomain(res.domains[0].name);
      })
      .catch(() => {
        setDomains([{ name: 'local', displayName: 'Local (Demo Users)', type: 'local', flowType: 'client_credentials' }]);
      });
  }, []);

  function handleDomainChange(name: string) {
    setSelectedDomain(name);
    setSelectedEmail('');
    setPassword('');
    setError(null);
    setShowPassword(false);
  }

  function handleUserSelect(email: string) {
    setSelectedEmail(email);
    setPassword(DEMO_USERS_PASSWORDS[email] ?? '');
    setError(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const { token } = await api.auth.login({ email: selectedEmail, password, domain: selectedDomain });
      setToken(token);
      const payload = decodeToken(token);
      const redirect = payload ? (ROLE_REDIRECTS[payload.role] ?? '/demo') : '/demo';
      router.push(redirect);
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedUser = users.find((u) => u.email === selectedEmail);
  const currentDomain = domains.find((d) => d.name === selectedDomain);
  const flowType = currentDomain?.flowType ?? (currentDomain?.type === 'local' ? 'client_credentials' : currentDomain?.type);
  const isCredentialFlow = !flowType || flowType === 'client_credentials';
  const isLocalDomain = selectedDomain === 'local';

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🏦</div>
          <h1 className="text-2xl font-bold">Payment Gateway Demo</h1>
          <p className="text-gray-500 text-sm mt-1">Application Mode: Sign In</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Authentication Domain */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Authentication Domain
                <Tooltip text="Select the identity provider. client_credentials domains show a login form; OIDC/SAML domains redirect to the external provider." />
              </label>
              {flowType && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FLOW_TYPE_COLORS[flowType] ?? 'bg-gray-100 text-gray-600'}`}>
                  {FLOW_TYPE_LABELS[flowType] ?? flowType}
                </span>
              )}
            </div>
            {domains.length === 0 ? (
              <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 animate-pulse">
                Loading domains…
              </div>
            ) : (
              <select
                value={selectedDomain}
                onChange={(e) => handleDomainChange(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
              >
                {domains.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.displayName}
                  </option>
                ))}
              </select>
            )}
            {currentDomain?.alertMessage && (
              <p className="text-xs text-amber-600 mt-0.5">{currentDomain.alertMessage}</p>
            )}
          </div>

          {/* ── Redirect-based flow (OIDC / SAML / authorization_code) ── */}
          {!isCredentialFlow && currentDomain && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
              <p className="text-sm text-blue-800">
                <strong>{currentDomain.displayName}</strong> uses{' '}
                <strong>{FLOW_TYPE_LABELS[flowType ?? ''] ?? flowType}</strong>. You will be
                redirected to the provider to complete login.
              </p>
              <button
                type="button"
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                onClick={() => setError('External SSO redirect is not active in this demo build.')}
              >
                Sign in with {currentDomain.displayName} →
              </button>
            </div>
          )}

          {/* ── Client-credentials form (local domain) ── */}
          {isCredentialFlow && (
            <>
              {/* User selector (local domain only) */}
              {isLocalDomain && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Select User
                      <Tooltip text="Pre-seeded demo users for the local domain. Select one to auto-fill credentials. Passwords are bcrypt-hashed in the database, never stored in plaintext." />
                    </label>
                    {users.length === 0 ? (
                      <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 animate-pulse">
                        Loading users…
                      </div>
                    ) : (
                      <select
                        value={users.some((u) => u.email === selectedEmail) ? selectedEmail : ''}
                        onChange={(e) => handleUserSelect(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">Select a user…</option>
                        {users.map((u) => (
                          <option key={u.email} value={u.email}>
                            {u.name} ({ROLE_LABELS[u.role] ?? u.role})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                      <Tooltip text="Select a user above to auto-fill, or type a custom email address." />
                    </label>
                    <input
                      type="email"
                      value={selectedEmail}
                      onChange={(e) => {
                        const email = e.target.value;
                        setSelectedEmail(email);
                        if (DEMO_USERS_PASSWORDS[email]) setPassword(DEMO_USERS_PASSWORDS[email]);
                        setError(null);
                      }}
                      placeholder="user@example.com"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Email field for non-local domains */}
              {!isLocalDomain && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={selectedEmail}
                    onChange={(e) => { setSelectedEmail(e.target.value); setError(null); }}
                    placeholder="user@example.com"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
              )}

              {/* Password with show/hide toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                  <Tooltip text="Auto-filled from the demo credential store for local users. The actual password is hashed (bcrypt, 12 rounds) in MongoDB. Atlas never sees the plaintext." />
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLocalDomain ? 'Auto-filled on user selection' : 'Enter password'}
                    className="w-full border rounded-lg px-3 py-2 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors text-sm"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {isCredentialFlow && (
            <button
              type="submit"
              disabled={!selectedEmail || !password || submitting}
              suppressHydrationWarning
              className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-40"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          )}
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          {isLocalDomain
            ? 'Select any user to auto-fill credentials. All local demo accounts share the same demo password.'
            : isCredentialFlow
            ? 'Enter credentials for the selected identity provider.'
            : 'You will be redirected to complete authentication.'}
        </p>

        <div className="mt-4 text-center">
          <Link href="/" className="text-xs text-gray-400 hover:text-[#001E2B] transition-colors">
            ← Back to Mode Selection
          </Link>
        </div>
      </div>
    </div>
  );
}
