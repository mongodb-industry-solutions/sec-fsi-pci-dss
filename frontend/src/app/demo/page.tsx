'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthUser, AuthDomain } from '../../lib/api';
import { setToken, decodeToken } from '../../lib/auth';
import { DEMO_USERS_PASSWORDS, ROLE_LABELS } from '../../lib/constants';
import { Tooltip } from '../../components/Tooltip';

const ROLE_REDIRECTS: Record<string, string> = {
  customer: '/demo/payment/history',
  level1_analyst: '/demo/investigation',
  level2_investigator: '/demo/investigation',
  security_auditor: '/demo/audit',
};

export default function DemoLoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [domains, setDomains] = useState<AuthDomain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('local');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth.users().then((res) => setUsers(res.users)).catch(() => {});
    api.auth.domains()
      .then((res) => {
        setDomains(res.domains);
        if (res.domains.length > 0) setSelectedDomain(res.domains[0].name);
      })
      .catch(() => {
        // Fallback: show only local domain if backend unavailable
        setDomains([{ name: 'local', displayName: 'Local (Demo Users)', type: 'local' }]);
      });
  }, []);

  function handleDomainChange(name: string) {
    setSelectedDomain(name);
    setSelectedEmail('');
    setPassword('');
    setError(null);
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
  const isLocalDomain = selectedDomain === 'local';
  const currentDomain = domains.find((d) => d.name === selectedDomain);

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🏦</div>
          <h1 className="text-2xl font-bold">PCI DSS Demo</h1>
          <p className="text-gray-500 text-sm mt-1">Application Mode - Sign In</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Authentication Domain */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Authentication Domain
              <Tooltip text="Select the identity provider to use for this login. Only enabled domains are shown. Manage domains via the authenticationDomain collection (BIAN SD-16)." />
            </label>
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
            {currentDomain && currentDomain.type !== 'local' && (
              <p className="text-xs text-amber-600 mt-0.5">
                ⚠ {currentDomain.displayName} integration is configured but not yet active in this demo build.
              </p>
            )}
          </div>

          {/* User selector (local domain only) */}
          {isLocalDomain && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select User
                <Tooltip text="Pre-seeded demo users for the local domain. Select one to auto-fill credentials. Passwords are bcrypt-hashed in the database, never stored in plaintext." />
              </label>
              <select
                value={selectedEmail}
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
              {selectedUser && (
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{selectedEmail}</p>
              )}
            </div>
          )}

          {/* Email field for non-local domains or manual override */}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
              <Tooltip text="Auto-filled from the demo credential store for local users. The actual password is hashed (bcrypt, 12 rounds) in MongoDB. Atlas never sees the plaintext." />
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLocalDomain ? 'Auto-filled on user selection' : 'Enter password'}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedEmail || !password || submitting}
            className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-40"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          {isLocalDomain
            ? 'Select any user to auto-fill credentials. All local demo accounts share the same demo password.'
            : 'Enter credentials for the selected identity provider.'}
        </p>
      </div>
    </div>
  );
}
