'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, Copy, Check, RefreshCw, Trash2, Plus, Eye, EyeOff,
  ExternalLink, ChevronDown, KeyRound, Globe, Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../lib/debugMode';
import { api, type MerchantOAuthClient, type TypedWebhookConfig } from '../../../../../lib/api';

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_SCOPES = ['openid', 'profile', 'email', 'phone', 'read:transactions', 'read:userinfo'];
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Required for OIDC; issues id_token',
  profile: 'name, preferred_username',
  email: 'email address',
  phone: 'phone_number',
  'read:transactions': 'Access to transaction data (PCI DSS Req 7)',
  'read:userinfo': 'Full userinfo profile',
};
const ALL_GRANT_TYPES = ['authorization_code', 'client_credentials', 'refresh_token'] as const;
const GRANT_LABELS: Record<string, string> = {
  authorization_code: 'Authorization Code (+ PKCE)',
  client_credentials: 'Client Credentials (server-to-server)',
  refresh_token: 'Refresh Token',
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

function UriListEditor({ uris, onChange, placeholder }: { uris: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      {uris.map((uri, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={uri}
            onChange={(e) => onChange(uris.map((u, j) => j === i ? e.target.value : u))}
            placeholder={placeholder}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          />
          <button type="button" onClick={() => onChange(uris.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...uris, ''])}
        className="flex items-center gap-1 text-xs text-[#001E2B] hover:underline"
      >
        <Plus size={12} /> Add URI
      </button>
    </div>
  );
}

// ── Role mapping editor ───────────────────────────────────────────────────────

const PSP_ROLES: { key: string; label: string; description: string }[] = [
  { key: 'customer',              label: 'Customer',             description: 'End user authenticating via OIDC' },
  { key: 'merchant_officer',      label: 'Merchant Officer',     description: 'Merchant admin with full portal access' },
  { key: 'security_auditor',      label: 'Security Auditor',     description: 'Read-only audit access (PCI DSS Req 10)' },
  { key: 'level1_analyst',        label: 'L1 Analyst',           description: 'First-level fraud analyst' },
  { key: 'level2_investigator',   label: 'L2 Investigator',      description: 'Senior investigator with case escalation' },
];

function RoleMappingEditor({
  mapping,
  onChange,
}: {
  mapping: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="mb-2">
        <span className="text-xs font-medium text-gray-700">Role mapping</span>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Map PSP role identifiers to the role names your system uses. Leave blank to pass the PSP role through unchanged.
          The mapped value is included in the <span className="font-mono">role</span> claim of issued tokens.
        </p>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_20px_1fr] gap-2 mb-1 px-1">
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">PSP role</span>
          <span />
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Your role name</span>
        </div>
        {PSP_ROLES.map(({ key, label, description }) => (
          <div key={key} className="grid grid-cols-[1fr_20px_1fr] gap-2 items-center group">
            <div className="border border-gray-200 bg-gray-50 rounded px-2 py-1.5">
              <span className="text-xs font-mono text-gray-700">{key}</span>
              <span className="text-[10px] text-gray-400 block leading-tight">{label}</span>
            </div>
            <span className="text-gray-300 text-center text-xs select-none">→</span>
            <input
              value={mapping[key] ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  const { [key]: _, ...rest } = mapping;
                  onChange(rest);
                } else {
                  onChange({ ...mapping, [key]: val });
                }
              }}
              placeholder={key}
              title={description}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#00ED64]/40 placeholder:text-gray-300"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Create form (shown when no OAuth client exists) ───────────────────────────

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
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [client, setClient] = useState<MerchantOAuthClient | null | undefined>(undefined);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [oauthWebhooks, setOauthWebhooks] = useState<TypedWebhookConfig[]>([]);
  const [loadError, setLoadError] = useState(false);

  // Config edit state (Authorization section)
  const [redirectUris, setRedirectUris] = useState<string[]>([]);
  const [postLogoutUris, setPostLogoutUris] = useState<string[]>([]);
  const [logoUri, setLogoUri] = useState('');
  const [clientUri, setClientUri] = useState('');
  const [grantTypes, setGrantTypes] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [requirePkce, setRequirePkce] = useState(true);
  const [tokenLifetime, setTokenLifetime] = useState(3600);
  const [refreshLifetime, setRefreshLifetime] = useState(30);
  const [claimMapping, setClaimMapping] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // OAuth event callbacks state
  const [grantedCallbackUrl, setGrantedCallbackUrl] = useState('');
  const [revokedCallbackUrl, setRevokedCallbackUrl] = useState('');
  const [callbackSaving, setCallbackSaving] = useState(false);
  const [callbackSaved, setCallbackSaved] = useState(false);

  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    if (!merchantId || !token) return;
    try {
      const [clientRes, webhooksRes] = await Promise.all([
        api.merchants.getOAuthClient(merchantId, token).catch(() => null),
        api.merchants.listTypedWebhooks(merchantId, token).catch(() => ({ webhooks: [] })),
      ]);
      setClient(clientRes);
      if (clientRes) {
        setRedirectUris(clientRes.oauthRedirectUris ?? []);
        setPostLogoutUris(clientRes.oauthPostLogoutRedirectUris ?? []);
        setGrantTypes(clientRes.oauthGrantTypes ?? []);
        setScopes(clientRes.oauthScopes ?? []);
        setRequirePkce(clientRes.oauthRequirePkce ?? true);
        setTokenLifetime(clientRes.oauthTokenLifetimeSeconds ?? 3600);
        setRefreshLifetime(clientRes.oauthRefreshTokenLifetimeDays ?? 30);
        setClaimMapping(clientRes.oauthClaimMapping ?? {});
        setLogoUri(clientRes.oauthLogoUri ?? '');
        setClientUri(clientRes.oauthClientUri ?? '');
      }
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

  function syncToState(updated: MerchantOAuthClient) {
    setClient(updated);
    setRedirectUris(updated.oauthRedirectUris ?? []);
    setPostLogoutUris(updated.oauthPostLogoutRedirectUris ?? []);
    setGrantTypes(updated.oauthGrantTypes ?? []);
    setScopes(updated.oauthScopes ?? []);
    setRequirePkce(updated.oauthRequirePkce ?? true);
    setTokenLifetime(updated.oauthTokenLifetimeSeconds ?? 3600);
    setRefreshLifetime(updated.oauthRefreshTokenLifetimeDays ?? 30);
    setClaimMapping(updated.oauthClaimMapping ?? {});
    setLogoUri(updated.oauthLogoUri ?? '');
    setClientUri(updated.oauthClientUri ?? '');
  }

  async function saveConfig() {
    if (!client) return;
    setConfigSaving(true);
    try {
      const updated = await api.merchants.updateOAuthClient(merchantId, token, {
        redirect_uris: redirectUris.filter(Boolean),
        post_logout_redirect_uris: postLogoutUris.filter(Boolean),
        grant_types: grantTypes,
        scopes,
        require_pkce: requirePkce,
        token_lifetime_seconds: tokenLifetime,
        refresh_token_lifetime_days: refreshLifetime,
        claim_mapping: claimMapping,
        logo_uri: logoUri.trim(),
        client_uri: clientUri.trim(),
      });
      syncToState(updated);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch { /* ignore */ }
    setConfigSaving(false);
  }

  async function saveCallbacks() {
    setCallbackSaving(true);
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
    } catch { /* ignore */ }
    setCallbackSaving(false);
  }

  async function rotate() {
    if (!window.confirm('Rotate the client secret? The current secret will stop working immediately.')) return;
    setRotating(true);
    try {
      const r = await api.merchants.rotateOAuthClientSecret(merchantId, token);
      setNewSecret(r.oauthClientSecret);
      setShowSecret(true);
    } catch { /* ignore */ }
    setRotating(false);
  }

  async function revokeClient() {
    if (!window.confirm('Revoke this OAuth application? All issued tokens become invalid immediately.')) return;
    setRevoking(true);
    try {
      await api.merchants.revokeOAuthClient(merchantId, token);
      setClient(null);
      setNewSecret(null);
    } catch { /* ignore */ }
    setRevoking(false);
  }

  // OIDC endpoints (relative paths, prepend backend base URL)
  const issuerBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8081` : '';
  const endpoints = [
    { label: 'Discovery', value: `${issuerBase}/.well-known/openid-configuration` },
    { label: 'Authorize', value: `${issuerBase}/api/v1/auth/authorize` },
    { label: 'Token', value: `${issuerBase}/api/v1/auth/token` },
    { label: 'JWKS', value: `${issuerBase}/api/v1/auth/jwks` },
    { label: 'Userinfo', value: `${issuerBase}/api/v1/auth/userinfo` },
    { label: 'Introspect', value: `${issuerBase}/api/v1/auth/introspect` },
    { label: 'Revoke token', value: `${issuerBase}/api/v1/auth/revoke` },
    { label: 'Logout', value: `${issuerBase}/api/v1/auth/logout` },
  ];

  if (!merchant) return null;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (client === undefined) {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <SectionHeader icon={ShieldCheck} title="SSO" description="Configure your application's integration with PSP identity." debugInfo="BIAN SD-89 BQ:Grant, SD-16, ADR-033-037, OIDC Core 1.0, RFC 6749" />
        <p className="text-sm text-gray-400 mt-6">Loading...</p>
      </div>
    );
  }

  // ── No client yet ──────────────────────────────────────────────────────────
  if (client === null) {
    return (
      <div className="w-full px-5 sm:px-8 py-6 space-y-5">
        <SectionHeader icon={ShieldCheck} title="SSO" description="Configure your application's integration with PSP identity." debugInfo="BIAN SD-89 BQ:Grant, SD-16, ADR-033-037, OIDC Core 1.0, RFC 6749" />

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
              <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><Globe size={14} className="text-gray-400" /> OIDC Endpoints</p>
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

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={ShieldCheck}
        title="SSO"
        description="Manage your application's OAuth 2.0 client, redirect URIs, scopes, and event callbacks."
        debugInfo="BIAN SD-89 BQ:Grant, SD-16, ADR-033-037, OIDC Core 1.0, RFC 6749"
      />

      {/* ── 1. Client credentials ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-0.5">Application credentials</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${client.oauthClientStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {client.oauthClientStatus}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button" onClick={rotate} disabled={rotating}
              className="flex items-center gap-1.5 text-xs border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={rotating ? 'animate-spin' : ''} /> Rotate secret
            </button>
            <button
              type="button" onClick={revokeClient} disabled={revoking}
              className="flex items-center gap-1.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} /> Revoke
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Client ID</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
              <code className="text-xs text-gray-700 flex-1 break-all">{client.oauthClientId}</code>
              <CopyButton value={client.oauthClientId} small />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Client Secret</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
              <code className="text-xs text-gray-500 flex-1">{client.oauthClientSecretPrefix}••••••••••••••••••••••••</code>
              <span className="text-[10px] text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">prefix only</span>
            </div>
          </div>
        </div>

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

      {/* ── 2. Authorization config ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <p className="text-sm font-semibold text-gray-800">Authorization settings</p>

        {/* Redirect URIs */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Redirect URIs
            <span className="text-gray-400 font-normal ml-1">(authorization_code callbacks)</span>
          </label>
          <UriListEditor uris={redirectUris} onChange={setRedirectUris} placeholder="https://your-app.com/auth/callback" />
        </div>

        {/* Post-logout URIs */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Post-logout redirect URIs
            <span className="text-gray-400 font-normal ml-1">(optional)</span>
          </label>
          <UriListEditor uris={postLogoutUris} onChange={setPostLogoutUris} placeholder="https://your-app.com/signed-out" />
        </div>

        {/* Branding (OIDC logo_uri / client_uri) */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Logo URL
            <span className="text-gray-400 font-normal ml-1">(OIDC logo_uri — shown on the consent page & app listings)</span>
          </label>
          <input
            type="url"
            value={logoUri}
            onChange={(e) => setLogoUri(e.target.value)}
            placeholder="https://your-app.com/logo.svg"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          />
          <p className="text-xs text-gray-400 mt-1">https only (http allowed for localhost). Leave empty to clear.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Home page URL
            <span className="text-gray-400 font-normal ml-1">(OIDC client_uri)</span>
          </label>
          <input
            type="url"
            value={clientUri}
            onChange={(e) => setClientUri(e.target.value)}
            placeholder="https://your-app.com"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          />
          <p className="text-xs text-gray-400 mt-1">https only (http allowed for localhost). Leave empty to clear.</p>
        </div>

        {/* Grant types */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Grant types</label>
          <div className="space-y-2">
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

        {/* Scopes */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Allowed scopes</label>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                  className="accent-[#001E2B] mt-0.5"
                />
                <span>
                  <code className="text-xs">{s}</code>
                  <span className="text-[11px] text-gray-400 ml-1">{SCOPE_DESCRIPTIONS[s]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Security + lifetimes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 border-t border-gray-100">
          <div className="sm:col-span-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={requirePkce} onChange={(e) => setRequirePkce(e.target.checked)} className="accent-[#001E2B]" />
              Require PKCE (S256), recommended for public clients
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Access token lifetime (seconds)</label>
            <input
              type="number" min={300} max={86400} value={tokenLifetime}
              onChange={(e) => setTokenLifetime(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">{Math.round(tokenLifetime / 60)} min</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Refresh token lifetime (days)</label>
            <input
              type="number" min={1} max={365} value={refreshLifetime}
              onChange={(e) => setRefreshLifetime(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>
        </div>

        {/* Role mapping */}
        <RoleMappingEditor mapping={claimMapping} onChange={setClaimMapping} />

        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            type="button" onClick={saveConfig} disabled={configSaving}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
          >
            {configSaving ? 'Saving...' : <><Check size={14} /> Save settings</>}
          </button>
          {configSaved && <span className="text-sm text-green-700 flex items-center gap-1"><Check size={13} /> Saved.</span>}
        </div>
      </div>

      {/* ── 3. OAuth event callbacks ── */}
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
        </div>
      </div>

      {/* ── 4. Integration reference ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
          <Globe size={14} className="text-gray-400" /> OIDC endpoints
          <a
            href={`${issuerBase}/.well-known/openid-configuration`}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto text-xs text-gray-400 hover:text-[#001E2B] flex items-center gap-1"
          >
            Open discovery <ExternalLink size={11} />
          </a>
        </p>
        {endpoints.map((e) => <EndpointRow key={e.label} {...e} />)}

        {debugMode && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-xs font-medium text-gray-600 mb-2">Example authorization request (PKCE)</p>
            <pre className="text-[11px] font-mono text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">{`GET ${issuerBase}/api/v1/auth/authorize
  ?response_type=code
  &client_id=${client.oauthClientId}
  &redirect_uri=<your_redirect_uri>
  &scope=openid+profile+email
  &state=<random_state>
  &code_challenge=<S256_challenge>
  &code_challenge_method=S256`}</pre>
          </div>
        )}
      </div>

      {loadError && (
        <p className="text-xs text-red-500">Failed to load some data. Check your connection.</p>
      )}
    </div>
  );
}
