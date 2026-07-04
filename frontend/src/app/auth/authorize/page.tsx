/**
 * OAuth 2.0 Consent Page (server component)
 * Path: /auth/authorize
 * Receives the same query params as the backend /api/v1/auth/authorize endpoint,
 * validates the request against the backend, and renders the consent form.
 */
import { headers } from 'next/headers';
import OAuthConsentForm from './OAuthConsentForm';

interface AuthorizePageProps {
  searchParams: Record<string, string>;
}

interface ConsentInfo {
  client_name: string;
  client_id: string;
  scopes: string[];
  redirect_uri: string;
  state?: string;
  code_challenge?: string;
  nonce?: string;
}

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  openid: { label: 'Identity', description: 'Verify your identity' },
  profile: { label: 'Profile', description: 'Read your name and username' },
  email: { label: 'Email', description: 'Read your email address' },
  phone: { label: 'Phone', description: 'Read your phone number' },
  'read:transactions': { label: 'Transactions', description: 'View your transaction history' },
  'read:userinfo': { label: 'User Info', description: 'Read your full profile information' },
};

async function fetchConsentInfo(searchParams: Record<string, string>): Promise<ConsentInfo | { error: string }> {
  const backendUrl = process.env.PSP_URL_BACKEND_PRIVATE || process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC || 'http://localhost:8081';
  const qs = new URLSearchParams(searchParams as Record<string, string>).toString();

  try {
    const res = await fetch(`${backendUrl}/api/v1/auth/authorize?${qs}`, {
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error_description ?? data.error ?? 'Invalid request' };
    return data as ConsentInfo;
  } catch {
    return { error: 'Failed to reach authorization server' };
  }
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = searchParams ?? {};

  // Validate required OAuth params before hitting the backend.
  const required = ['client_id', 'redirect_uri', 'response_type', 'scope'] as const;
  const missing = required.filter((p) => !params[p]);
  if (missing.length > 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invalid Authorization Request</h1>
          <p className="text-gray-600 text-sm">Missing required parameters: {missing.join(', ')}.</p>
          <p className="text-gray-400 text-xs mt-2">This page must be reached through an OAuth authorization flow, not navigated to directly.</p>
        </div>
      </div>
    );
  }

  const info = await fetchConsentInfo(params);

  if ('error' in info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Authorization Error</h1>
          <p className="text-gray-600">{info.error}</p>
        </div>
      </div>
    );
  }

  const scopeDetails = info.scopes
    .filter((s) => s !== 'openid')
    .map((s) => SCOPE_LABELS[s] ?? { label: s, description: `Access to ${s.replace(':', ' ')}` });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Leafy Pay</h1>
          <p className="text-sm text-gray-500 mt-1">Secure OAuth Authorization</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* App requesting access */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{info.client_name}</span>
              {' '}is requesting access to your account
            </p>
          </div>

          {/* Scopes */}
          {scopeDetails.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">This app will be able to:</p>
              <ul className="space-y-2">
                {scopeDetails.map((s) => (
                  <li key={s.label} className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-700">
                      <span className="font-medium">{s.label}</span>
                      {' — '}{s.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Consent form (client component handles login + allow/deny) */}
          <OAuthConsentForm
            clientId={info.client_id}
            clientName={info.client_name}
            redirectUri={info.redirect_uri}
            scopes={info.scopes}
            state={info.state}
            codeChallenge={info.code_challenge}
            nonce={info.nonce}
            originalSearchParams={params}
          />
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          By allowing, you agree that {info.client_name} may access your Leafy Pay account
          in accordance with the permissions above.
        </p>
      </div>
    </div>
  );
}
