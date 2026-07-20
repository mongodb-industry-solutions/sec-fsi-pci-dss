/**
 * OAuth 2.0 Consent Page (server component)
 * Path: /auth/authorize
 * Receives the same query params as the backend /api/v1/auth/authorize endpoint,
 * validates the request against the backend, and renders the consent form.
 */
import { headers } from 'next/headers';
import OAuthConsentForm, { MerchantAvatar } from './OAuthConsentForm';

interface AuthorizePageProps {
  // Next.js 15+/16: searchParams is a Promise and must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface ScopeDescriptor {
  scope: string;
  description: string;
  required: boolean;
}

interface ConsentInfo {
  client_name: string;
  client_id: string;
  scopes: string[];
  scope_details?: ScopeDescriptor[];
  logo_uri?: string;
  client_uri?: string;
  redirect_uri: string;
  state?: string;
  code_challenge?: string;
  nonce?: string;
}

async function fetchConsentInfo(searchParams: Record<string, string>): Promise<ConsentInfo | { error: string }> {
  // Server-side call: reach the backend via the in-cluster PRIVATE URL (same var the next.config
  // rewrites use). PSP_URL_BACKEND_PRIVATE (unprefixed) is honoured if set, then the build-time
  // NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE, then the public URL, then localhost. Without the private
  // fallback the frontend pod tried the public backend host (often not egress-reachable) → the
  // authorize consent fetch failed with "Failed to reach authorization server".
  const backendUrl =
    process.env.PSP_URL_BACKEND_PRIVATE ||
    process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE ||
    process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC ||
    'http://localhost:8081';
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
  // Await the params Promise (Next 16) and normalize to a flat string map.
  const raw = (await searchParams) ?? {};
  const params: Record<string, string> = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? '') : (v ?? '')]),
  );

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

  // Scope metadata comes from the backend catalog (E-01/E-03); fall back to a bare list if absent.
  const scopeDetails: ScopeDescriptor[] =
    info.scope_details ?? info.scopes.map((s) => ({ scope: s, description: `Access to ${s}`, required: s === 'openid' }));

  // Demo convenience: prefill the login form from the authorize URL.
  // login_hint is the standard OIDC param; prefill_email is a demo-only alias.
  const prefillEmail = params.login_hint || params.prefill_email || '';
  // prefill_password is accepted ONLY in non-production builds: URLs leak into browser history,
  // server/proxy logs and Referer headers, so a password must never ride in a query param in prod.
  const prefillPassword = process.env.NODE_ENV !== 'production' ? (params.prefill_password || '') : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/app-logo.png" alt="Sec4 Pay" className="h-14 w-auto mx-auto mb-3" />
          <p className="text-sm text-gray-500 mt-1">Payments made effortless and secure</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* App requesting access — merchant logo (OIDC logo_uri) with graceful fallback (E-11) */}
          <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
            <MerchantAvatar logoUri={info.logo_uri} clientName={info.client_name} />
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{info.client_name}</span>
              {' '}is requesting access to your account
            </p>
          </div>

          {/* Consent form (client component handles login + granular scope selection + allow/deny) */}
          <OAuthConsentForm
            clientId={info.client_id}
            clientName={info.client_name}
            logoUri={info.logo_uri}
            redirectUri={info.redirect_uri}
            scopeDetails={scopeDetails}
            state={info.state}
            codeChallenge={info.code_challenge}
            nonce={info.nonce}
            originalSearchParams={params}
            prefillEmail={prefillEmail}
            prefillPassword={prefillPassword}
          />
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          By allowing, you agree that {info.client_name} may access your Sec4 Pay account
          in accordance with the permissions above.
        </p>
      </div>
    </div>
  );
}
