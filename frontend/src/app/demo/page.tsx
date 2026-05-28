'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthUser } from '../../lib/api';
import { setToken, decodeToken } from '../../lib/auth';
import { DEMO_USERS_PASSWORDS, ROLE_LABELS } from '../../lib/constants';

const ROLE_REDIRECTS: Record<string, string> = {
  customer: '/demo/payment/history',
  level1_analyst: '/demo/investigation',
  level2_investigator: '/demo/investigation',
  security_auditor: '/demo/audit',
};

export default function DemoLoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.auth.users().then((res) => setUsers(res.users)).catch(() => {});
  }, []);

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
      const { token } = await api.auth.login({ email: selectedEmail, password, domain: 'local' });
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

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🏦</div>
          <h1 className="text-2xl font-bold">PCI DSS Demo</h1>
          <p className="text-gray-500 text-sm mt-1">Sign In</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Authentication domain
            </label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" disabled>
              <option value="local">local (demo users)</option>
            </select>
            <p className="text-xs text-gray-400 mt-0.5">MS Entra ID: coming in v2</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <select
              value={selectedEmail}
              onChange={(e) => handleUserSelect(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.email} ({ROLE_LABELS[u.role] ?? u.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Auto-filled on user selection"
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
          Test users and their passwords are pre-seeded. Select any user to auto-fill credentials.
        </p>
      </div>
    </div>
  );
}
