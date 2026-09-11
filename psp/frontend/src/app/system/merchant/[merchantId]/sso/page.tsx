'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, Copy, Check, ExternalLink, KeyRound, Globe, Webhook, Landmark, Eye, EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Tooltip } from '../../../../../components/Tooltip';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { api, type MerchantOAuthClient, type TypedWebhookConfig } from '../../../../../lib/api';
import { BACKEND_PUBLIC_URL, BACKEND_PRIVATE_URL, AUTHORITY_UI_PUBLIC_URL } from '../../../../../lib/constants';

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_SCOPES = ['openid', 'profile', 'email', 'phone', 'read:transactions', 'read:userinfo'];
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Required for OIDC; issues id_token',
  profile: 'name, preferred_username',
  email: 'email address',
  phone: 'phone_number',
  'read:transactions': 'Access to transaction data (PCI DSS)',
  'read:userinfo': 'Full userinfo profile',
};
const ALL_GRANT_TYPES = ['authorization_code', 'client_credentials', 'refresh_token', 'urn:openid:params:grant-type:ciba'] as const;
const GRANT_LABELS: Record<string, string> = {
  authorization_code: 'Authorization Code (+ PKCE)',
  client_credentials: 'Client Credentials (server-to-server)',
  refresh_token: 'Refresh Token',
  'urn:openid:params:grant-type:ciba': 'CIBA (passwordless backchannel login)',
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: () => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); },
  };
}

function CopyButton({ value, small }: { value: string; small?: boolean }) {
  const { copied, copy } = useCopy(value);
  return (
    <button type="button" onClick={copy} className={`text-gray-400 hover:text-[#001E2B] transition-colors ${small ? 'p-0.5' : 'p-1'}`} title="Copy">
      {copied ? <Check size={small ? 12 : 14} className="text-green-600" /> : <Copy size={small ? 12 : 14} />}
    </button>
  );
}

function EndpointRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-36 shrink-0">{label}</span>
      <span className="text-xs font-mono text-gray-700 flex-1 truncate">{value}</span>
      <CopyButton value={value} small />
    </div>
  );
}

// ── Endpoint scope toggle (public vs private/in-VPC base URL) ──────────────────

function EndpointScopeToggle({ usePrivate, onChange }: { usePrivate: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-2.5 py-1 rounded-md transition-colors ${!usePrivate ? 'bg-[#001E2B] text-white' : 'text-gray-500 hover:text-[#001E2B]'}`}
      >
        Public URL
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-2.5 py-1 rounded-md transition-colors ${usePrivate ? 'bg-[#001E2B] text-white' : 'text-gray-500 hover:text-[#001E2B]'}`}
      >
        Private URL
      </button>
    </div>
  );
}

// ── Create form (shown when no OAuth client exists) ───────────────────────────
//
// Registration still goes through this app: it calls the identity authority on the merchant's
// behalf (with an operator credential this app holds and the merchant never sees) and records the
// client id it was given. What no longer happens here, once that registration exists, is EDITING
// it: the authority owns that record and offers a person who holds it exactly the same actions this
// screen used to duplicate, so viewing and changing it now happens there instead.

function CreateClientForm({ merchantId, token, onCreated }: { merchantId: string; token: string; onCreated: (secret: string) => void }) {
  const [redirectUri, setRedirectUri] = useState('');
  const [grantTypes, setGrantTypes] = useState<string[]>(['authorization_code', 'refresh_token']);
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile', 'email']);
  const [requirePkce, setRequirePkce] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!redirectUri.trim()) { setError('At least one redirect URI is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await api.merchants.createOAuthClient(merchantId, token, {
        redirect_uris: [redirectUri.trim()],
        grant_types: grantTypes,
        scopes,
        require_pkce: requirePkce,
        token_lifetime_seconds: 3600,
        refresh_token_lifetime_days: 30,
      });
      onCreated(r.oauthClientSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg || 'Failed to save OAuth configuration. Please try again.');
    }
    setSaving(false);
  }

  return (
    <form onSubmit={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 h-full">
      <div>
        <p className="text-sm font-semibold text-gray-800 mb-0.5">OAuth integration</p>
        <p className="text-xs text-gray-500">Generate credentials so your platform can authenticate PSP users via OIDC / OAuth 2.0.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">Redirect URI (required)</label>
        <input
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
          required
          placeholder="https://your-app.com/auth/callback"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Grant types</label>
          <div className="space-y-1.5">
            {ALL_GRANT_TYPES.map((g) => (
              <label key={g} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={grantTypes.includes(g)}
                  onChange={(e) => setGrantTypes(e.target.checked ? [...grantTypes, g] : grantTypes.filter((x) => x !== g))}
                  className="accent-[#001E2B]"
                />
                {GRANT_LABELS[g]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Allowed scopes</label>
          <div className="space-y-1.5">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer" title={SCOPE_DESCRIPTIONS[s]}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                  className="accent-[#001E2B]"
                />
                <code className="text-xs">{s}</code>
              </label>
            ))}
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={requirePkce} onChange={(e) => setRequirePkce(e.target.checked)} className="accent-[#001E2B]" />
        Require PKCE (S256), recommended for public clients
      </label>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={saving}
        className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-[#00ED64] font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
      >
        <KeyRound size={14} /> {saving ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MerchantSSOPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [client, setClient] = useState<MerchantOAuthClient | null | undefined>(undefined);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [oauthWebhooks, setOauthWebhooks] = useState<TypedWebhookConfig[]>([]);
  const [loadError, setLoadError] = useState(false);

  // OAuth event callbacks state
  const [grantedCallbackUrl, setGrantedCallbackUrl] = useState('');
  const [revokedCallbackUrl, setRevokedCallbackUrl] = useState('');
  const [callbackSaving, setCallbackSaving] = useState(false);
  const [callbackSaved, setCallbackSaved] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  // Frontend origin for the browser-facing Authorize/Logout endpoints. Set post-mount (not derived
  // during render) so SSR and the first client render both output '': reading window.location at
  // render time would differ between them and trigger a hydration mismatch.
  const [frontendBase, setFrontendBase] = useState('');
  useEffect(() => { setFrontendBase(window.location.origin); }, []);

  // OIDC endpoint base scope: public URL by default, or the private/in-VPC URL for integrators
  // wiring server-to-server calls from inside the private network. Only affects the backend
  // (server-to-server) endpoints; Authorize/Logout are browser-facing frontend pages either way.
  // Relevant only before a client exists: once one does, the authority's own page shows the same
  // pair, scoped to that specific registration rather than to this generic starting point.
  const hasPrivateUrl = BACKEND_PRIVATE_URL !== '' && BACKEND_PRIVATE_URL !== BACKEND_PUBLIC_URL;
  const privateBase = BACKEND_PRIVATE_URL || BACKEND_PUBLIC_URL; // fall back to public when unconfigured
  const [usePrivateEndpoints, setUsePrivateEndpoints] = useState(false);

  const load = useCallback(async () => {
    if (!merchantId || !token) return;
    try {
      const [clientRes, webhooksRes] = await Promise.all([
        api.merchants.getOAuthClient(merchantId, token).catch(() => null),
        api.merchants.listTypedWebhooks(merchantId, token).catch(() => ({ webhooks: [] })),
      ]);
      setClient(clientRes);
      const oauthHooks = (webhooksRes.webhooks ?? []).filter((w) =>
        w.webhookEventType === 'oauth.authorization_granted' || w.webhookEventType === 'oauth.authorization_revoked',
      );
      setOauthWebhooks(oauthHooks);
      setGrantedCallbackUrl(oauthHooks.find((w) => w.webhookEventType === 'oauth.authorization_granted')?.webhookUrl ?? '');
      setRevokedCallbackUrl(oauthHooks.find((w) => w.webhookEventType === 'oauth.authorization_revoked')?.webhookUrl ?? '');
    } catch {
      setLoadError(true);
    }
  }, [merchantId, token]);

  useEffect(() => { load(); }, [load]);

  async function saveCallbacks() {
    setCallbackSaving(true);
    setCallbackError(null);
    try {
      async function upsertCallback(eventType: 'oauth.authorization_granted' | 'oauth.authorization_revoked', url: string) {
        if (!url.trim()) return;
        const existing = oauthWebhooks.find((w) => w.webhookEventType === eventType);
        if (existing) {
          await api.merchants.updateTypedWebhook(merchantId, existing.webhookId, token, { url: url.trim() });
        } else {
          await api.merchants.registerTypedWebhook(merchantId, token, { eventType, url: url.trim() });
        }
      }
      await Promise.all([
        upsertCallback('oauth.authorization_granted', grantedCallbackUrl),
        upsertCallback('oauth.authorization_revoked', revokedCallbackUrl),
      ]);
      await load();
      setCallbackSaved(true);
      setTimeout(() => setCallbackSaved(false), 3000);
    } catch (e) {
      setCallbackError(e instanceof Error ? e.message : 'Failed to save callbacks');
    }
    setCallbackSaving(false);
  }

  // OIDC endpoints, shown only before a client exists (see the comment on `hasPrivateUrl` above).
  const issuerBase = usePrivateEndpoints ? privateBase : BACKEND_PUBLIC_URL;
  const endpoints = [
    { label: 'Discovery', value: `${issuerBase}/.well-known/openid-configuration` },
    { label: 'Authorize', value: `${frontendBase}/auth/authorize` },
    { label: 'Token', value: `${issuerBase}/api/v1/auth/token` },
    { label: 'JWKS', value: `${issuerBase}/api/v1/auth/jwks` },
    { label: 'Userinfo', value: `${issuerBase}/api/v1/auth/userinfo` },
    { label: 'Introspect', value: `${issuerBase}/api/v1/auth/introspect` },
    { label: 'Revoke token', value: `${issuerBase}/api/v1/auth/revoke` },
    { label: 'Logout', value: `${frontendBase}/auth/logout` },
  ];

  if (!merchant) return null;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (client === undefined) {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <SectionHeader icon={ShieldCheck} title="SSO" description="Configure your application's integration with PSP identity." debugInfo="BQ:Grant, ADR-033-037, OIDC Core 1.0, RFC 6749" />
        <p className="text-sm text-gray-400 mt-6">Loading...</p>
      </div>
    );
  }

  // ── No client yet ──────────────────────────────────────────────────────────
  if (client === null) {
    return (
      <div className="w-full px-5 sm:px-8 py-6 space-y-5">
        <SectionHeader icon={ShieldCheck} title="SSO" description="Configure your application's integration with PSP identity." debugInfo="BQ:Grant, ADR-033-037, OIDC Core 1.0, RFC 6749" />

        {newSecret && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 max-w-xl">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-amber-800">Client secret. Store it now; shown once.</p>
              <button onClick={() => setShowSecret((s) => !s)} className="text-amber-600 hover:text-amber-800">
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <p className="font-mono text-xs text-amber-900 break-all">{showSecret ? newSecret : '•'.repeat(48)}</p>
          </div>
        )}

        {!newSecret && (
          <div className="space-y-5">
            <CreateClientForm merchantId={merchantId} token={token} onCreated={(secret) => { setNewSecret(secret); setShowSecret(true); load(); }} />
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Globe size={14} className="text-gray-400" /> OIDC Endpoints</p>
                <EndpointScopeToggle usePrivate={usePrivateEndpoints} onChange={setUsePrivateEndpoints} />
              </div>
              {endpoints.map((e) => <EndpointRow key={e.label} {...e} />)}
            </div>
          </div>
        )}

        {newSecret && (
          <button onClick={load} className="text-sm text-[#001E2B] underline">Continue to configuration</button>
        )}
      </div>
    );
  }

  // ── Client exists ──────────────────────────────────────────────────────────

  const grantedHook = oauthWebhooks.find((w) => w.webhookEventType === 'oauth.authorization_granted');
  const revokedHook = oauthWebhooks.find((w) => w.webhookEventType === 'oauth.authorization_revoked');
  const giamClientUrl = `${AUTHORITY_UI_PUBLIC_URL}/system/credentials/applications/${encodeURIComponent(client.oauthClientId)}`;

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={ShieldCheck}
        title="SSO"
        description="The application itself is managed at the identity authority. This page is what stays here: event callbacks."
        debugInfo="BQ:Grant, ADR-033-037, OIDC Core 1.0, RFC 6749"
      />

      {/* ── 1. Managed at the identity authority ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 mb-0.5">Application registration</p>
            <p className="text-xs text-gray-500 max-w-xl">
              The name, redirect URIs, scopes, grant types and credential live at the identity authority,
              which is the party that actually enforces them. Editing a copy here could say one thing while
              the authority enforced another; that risk is gone once there is only one record.
            </p>
          </div>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${client.oauthClientStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {client.oauthClientStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center">
              Client ID
              <Tooltip text="The public OAuth 2.0 client identifier this application presents on every authorize/token request. Open it at the authority to change anything about the registration." />
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">{client.oauthClientId}</code>
              <CopyButton value={client.oauthClientId} small />
            </div>
          </div>
          <div>
            <span className={`text-[10px] text-gray-400 uppercase tracking-wide mb-1 flex items-center`}>
              Redirect URIs registered
            </span>
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {(client.oauthRedirectUris ?? []).length} address{(client.oauthRedirectUris ?? []).length === 1 ? '' : 'es'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(client.oauthGrantTypes ?? []).map((g) => (
            <span key={g} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-mono text-gray-600">
              {GRANT_LABELS[g] ?? g}
            </span>
          ))}
        </div>

        <a
          href={giamClientUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#001E2B] px-4 py-2 text-sm font-medium text-[#00ED64] transition-colors hover:bg-[#001E2B]/80"
        >
          <Landmark size={14} /> Manage at the identity authority <ExternalLink size={12} />
        </a>
        <p className="mt-2 text-xs text-gray-500">
          Opens the same identity session already active here: redirects, scopes, grant types, secret
          rotation and revocation all live on that one screen now.
        </p>

        {newSecret && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-amber-800">New secret. Store it now; shown once.</p>
              <button onClick={() => setShowSecret((s) => !s)} className="text-amber-600 hover:text-amber-800">
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <p className="font-mono text-xs text-amber-900 break-all">{showSecret ? newSecret : '•'.repeat(48)}</p>
          </div>
        )}
      </div>

      {/* ── 2. OAuth event callbacks ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Webhook size={14} className="text-gray-400" /> OAuth event callbacks</p>
          <p className="text-xs text-gray-500 mt-0.5">
            PSP posts a signed JSON payload to these URLs when OAuth authorization events occur.
            Delivery logs in <Link href={`/system/merchant/${merchantId}/events`} className="underline hover:text-[#001E2B]">Events</Link>.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Authorization granted
              {grantedHook && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${grantedHook.webhookStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{grantedHook.webhookStatus}</span>}
            </label>
            <input
              value={grantedCallbackUrl}
              onChange={(e) => setGrantedCallbackUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/oauth-granted"
              type="url"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Fired when a user authorizes your app via OIDC. Use to provision user accounts.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Authorization revoked
              {revokedHook && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${revokedHook.webhookStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{revokedHook.webhookStatus}</span>}
            </label>
            <input
              value={revokedCallbackUrl}
              onChange={(e) => setRevokedCallbackUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/oauth-revoked"
              type="url"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Fired when a user revokes access. Immediately invalidate their session on your side.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button" onClick={saveCallbacks} disabled={callbackSaving}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
          >
            {callbackSaving ? 'Saving...' : <><Check size={14} /> Save callbacks</>}
          </button>
          {callbackSaved && <span className="text-sm text-green-700 flex items-center gap-1"><Check size={13} /> Saved.</span>}
          {callbackError && <span className="text-sm text-red-600">{callbackError}</span>}
        </div>
      </div>

      {loadError && (
        <p className="text-xs text-red-500">Failed to load some data. Check your connection.</p>
      )}
    </div>
  );
}
