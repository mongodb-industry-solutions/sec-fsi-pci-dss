// Server-only env accessors. Secrets NEVER reach the browser (no NEXT_PUBLIC_).
// All merchant vars use the PSP_MERCHANT_ prefix.
import 'server-only';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const ENV = {
  // PSP API base — OIDC discovery + all API endpoints (backend, host port 8081).
  pspBaseUrl: () => req('PSP_MERCHANT_PSP_BASE_URL', 'http://localhost:8081'),
  // Browser-facing PSP consent/login page (PSP frontend). Backend /authorize returns JSON, not UI.
  pspAuthorizeUrl: () => req('PSP_MERCHANT_AUTHORIZE_URL', 'http://localhost:8080/auth/authorize'),
  clientId: () => req('PSP_MERCHANT_OAUTH_CLIENT_ID'),
  clientSecret: () => req('PSP_MERCHANT_OAUTH_CLIENT_SECRET'),
  // This app's public base URL (local default 8082; container listens on 8080 behind ingress).
  baseUrl: () => req('PSP_MERCHANT_BASE_URL', 'http://localhost:8082'),
  // Redirect URI defaults to <baseUrl>/api/auth/callback but can be overridden per env.
  redirectUri: () =>
    process.env.PSP_MERCHANT_REDIRECT_URI ??
    `${req('PSP_MERCHANT_BASE_URL', 'http://localhost:8082')}/api/auth/callback`,
  sessionSecret: () => req('PSP_MERCHANT_SESSION_SECRET'),
  // Espresso Works seeded SD-89 merchant agreement reference.
  merchantAgreementRef: () =>
    process.env.PSP_MERCHANT_AGREEMENT_REF ?? 'm0000001-0000-4000-8000-000000000001',
};

// Scopes requested by Espresso Works (must be a subset of the seeded client's scopes).
export const REQUESTED_SCOPES = [
  'openid',
  'profile',
  'payment:read',
  'payment:write',
  'beneficiary:read',
  'beneficiary:manage',
  'balance:read',
  'transactions:read',
];
