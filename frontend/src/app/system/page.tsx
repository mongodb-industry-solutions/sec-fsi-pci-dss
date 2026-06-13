'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Eye, EyeOff, Bug,
  BriefcaseMedical, CreditCard, Users, BarChart3, ClipboardList, User,
  PlusCircle, Store, ClipboardCheck, ShieldAlert, ScanLine, UserCheck,
  Building2, AlertTriangle, Plug, Zap, KeyRound, LayoutGrid,
  CheckCircle2, AlertCircle, Clock, WifiOff, Wrench, ShieldCheck,
  Network, Activity,
  type LucideIcon,
} from 'lucide-react';
import { api, AuthUser, AuthDomain } from '../../lib/api';
import { getToken, setToken, clearToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { DEMO_PASSWORD, ROLE_LABELS } from '../../lib/constants';
import { Tooltip } from '../../components/Tooltip';
import { useDebugMode } from '../../lib/debugMode';
import { UserMenu } from '../../components/UserMenu';
import { DemoSidebar, MobileBottomNav } from '../../components/DemoSidebar';
import { RoleStats } from '../../components/dashboard/RoleStats';
import { SectionHeader } from '../../components/SectionHeader';

type DecodedUser = NonNullable<ReturnType<typeof decodeToken>>;

// ── Role order (user dropdown in login form) ──────────────────────────────────

const ROLE_ORDER: Record<string, number> = {
  customer:            0,
  level1_analyst:      1,
  level2_investigator: 2,
  security_auditor:    3,
  merchant_officer:    4,
  manager:             5,
};

// ── Login form constants ──────────────────────────────────────────────────────

const FLOW_TYPE_LABELS: Record<string, string> = {
  client_credentials: 'Client Credentials',
  authorization_code: 'Authorization Code (OIDC)',
  saml:               'SAML 2.0',
  oidc:               'OIDC',
};

const FLOW_TYPE_COLORS: Record<string, string> = {
  client_credentials: 'bg-gray-100 text-gray-600',
  authorization_code: 'bg-blue-100 text-blue-700',
  saml:               'bg-purple-100 text-purple-700',
  oidc:               'bg-blue-100 text-blue-700',
};

// ── Dashboard card definitions ────────────────────────────────────────────────

interface DashboardCard {
  label:       string;
  description: string;
  icon:        LucideIcon;
  href:        string;
  bianSd?:     string;
  pciDss?:     string;
}

const ROLE_CARDS: Record<string, DashboardCard[]> = {
  customer: [
    { label: 'Transactions', description: 'Your payment history, with the status and any fraud review of each transaction.',            icon: ClipboardList, href: '/system/payment/history', bianSd: 'SD-27', pciDss: 'Req 7.2' },
    { label: 'New Payment',  description: 'Make a new card payment. The card is tokenized in the browser; the PAN never reaches Atlas.', icon: PlusCircle,    href: '/system/payment',         bianSd: 'SD-27', pciDss: 'Req 3' },
    { label: 'Payment Methods', description: 'View, add and remove your saved cards. Only the masked number is shown; the PAN and CVV are never stored.', icon: CreditCard, href: '/system/cards', bianSd: 'SD-88', pciDss: 'Req 3' },
    { label: 'Merchant',     description: 'Browse the registered merchants you can pay.',                                                icon: Store,         href: '/system/merchant',        bianSd: 'SD-89', pciDss: 'Req 12' },
    { label: 'Profile',      description: 'Your account and contact details. Sensitive fields are encrypted at rest with Queryable Encryption.', icon: User,    href: '/system/profile',         bianSd: 'SD-53', pciDss: 'Req 8' },
  ],
  level1_analyst: [
    { label: 'Cases',        description: 'Fraud investigation cases. Search by case reference (FD-…), email, phone or card token, and escalate to L2.', icon: BriefcaseMedical, href: '/system/investigation', bianSd: 'SD-63', pciDss: 'Req 10.4' },
    { label: 'Transactions', description: 'Search all card transactions. Sensitive gateway data stays encrypted (QE:none) at the L1 access level.',     icon: CreditCard,       href: '/system/transactions',  bianSd: 'SD-27', pciDss: 'Req 10.2' },
    { label: 'Users',        description: 'Look up a customer by encrypted email, phone or account reference (QE equality — no plaintext leaves the app).', icon: Users,          href: '/system/users',         bianSd: 'SD-53', pciDss: 'Req 12.3' },
    { label: 'Merchant',     description: 'Browse merchants and open one for its KYB status and received-payment activity.',              icon: Store,            href: '/system/merchant',      bianSd: 'SD-89', pciDss: 'Req 12.8' },
  ],
  level2_investigator: [
    { label: 'Cases',        description: 'Approve escalations, unlock QE:none PII with an escalation token, and resolve cases as fraud or cleared.', icon: BriefcaseMedical, href: '/system/investigation', bianSd: 'SD-63', pciDss: 'Req 10.4' },
    { label: 'Transactions', description: 'Forensic transaction analysis. With an escalation token, raw gateway/processor fields decrypt for review.',  icon: CreditCard,       href: '/system/transactions',  bianSd: 'SD-27', pciDss: 'Req 10.2' },
    { label: 'Users',        description: 'Customer records and agreement detail, including escalated access to sensitive fields.',        icon: Users,            href: '/system/users',         bianSd: 'SD-53', pciDss: 'Req 12.3' },
    { label: 'Merchant',     description: 'Merchant due-diligence: KYB, risk and received-payment activity.',                             icon: Store,            href: '/system/merchant',      bianSd: 'SD-89', pciDss: 'Req 12.8' },
  ],
  security_auditor: [
    { label: 'Cases',        description: 'Read-only view of every fraud case and its complete, append-only audit trail.',               icon: BriefcaseMedical, href: '/system/investigation', bianSd: 'SD-63', pciDss: 'Req 10.4' },
    { label: 'Transactions', description: 'Full transaction audit view — all fields visible for review, no modifications permitted.',     icon: CreditCard,       href: '/system/transactions',  bianSd: 'SD-27', pciDss: 'Req 10.2.1' },
    { label: 'Users',        description: 'Customer and staff account compliance review (authentication records, roles).',               icon: Users,            href: '/system/users',         bianSd: 'SD-91', pciDss: 'Req 8.2' },
    { label: 'Audit Log',      description: 'System-wide, append-only security event log across all cases (who did what, when).',          icon: BarChart3,  href: '/system/audit',     bianSd: 'SD-16', pciDss: 'Req 10' },
    { label: 'Audit Events',   description: 'Unified audit trail across business, compliance and integration events. Inspect each payload for analysis or replay.', icon: Activity, href: '/system/audit-events', bianSd: 'SD-193', pciDss: 'Req 10.2' },
    { label: 'Data Integrity', description: 'Verify control-record integrity: no duplicate case references, links resolve, counts reconcile.', icon: ShieldCheck, href: '/system/integrity', bianSd: 'SD-83', pciDss: 'Req 10' },
    { label: 'Merchant',       description: 'Merchant compliance, KYB and lifecycle audit trail across the whole portfolio.',             icon: Store,      href: '/system/merchant',  bianSd: 'SD-89', pciDss: 'Req 12.8' },
  ],
  merchant_officer: [
    { label: 'Review Queue', description: 'Approve or reject pending merchant applications — the KYB decision (BIAN Control action).',    icon: ClipboardCheck, href: '/system/merchant/review', bianSd: 'SD-89', pciDss: 'Req 12.8' },
    { label: 'All Merchants',description: 'Full merchant portfolio. Open any merchant for its KYB, activity and lifecycle audit trail.',   icon: Store,          href: '/system/merchant',        bianSd: 'SD-89', pciDss: 'Req 12.8' },
    { label: 'My Profile',   description: 'Manage your officer profile and contact details.',                                            icon: User,           href: '/system/profile',         bianSd: 'SD-53', pciDss: 'Req 8' },
  ],
  manager: [],
};

const ROLE_ACCENT: Record<string, { iconBg: string; iconText: string; badge: string }> = {
  customer:            { iconBg: 'bg-blue-50',   iconText: 'text-blue-600',   badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  level1_analyst:      { iconBg: 'bg-amber-50',  iconText: 'text-amber-600',  badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  level2_investigator: { iconBg: 'bg-orange-50', iconText: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  security_auditor:    { iconBg: 'bg-purple-50', iconText: 'text-purple-600', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  merchant_officer:    { iconBg: 'bg-teal-50',   iconText: 'text-teal-600',   badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  manager:             { iconBg: 'bg-slate-100', iconText: 'text-slate-600',  badge: 'bg-slate-50 text-slate-700 border-slate-200' },
};

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const { debugMode, toggleDebug } = useDebugMode();
  const [users, setUsers]       = useState<AuthUser[]>([]);
  const [domains, setDomains]   = useState<AuthDomain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('local');
  const [selectedEmail, setSelectedEmail]   = useState('');
  const [password, setPassword]             = useState('');
  const [showPassword, setShowPassword]     = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  const displayUsers = useMemo(() => {
    const sorted = [...users].sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));
    let n = 0;
    return sorted.filter((u) => (u.role === 'customer' ? ++n <= 4 : true));
  }, [users]);

  useEffect(() => {
    setSelectedEmail(''); setPassword(''); setSubmitting(false); setError(null);
  }, []);

  useEffect(() => {
    api.system.users(true).then((r) => setUsers(r.users)).catch(() =>
      api.auth.users(true).then((r) => setUsers(r.users)).catch(() => {}));
    api.auth.domains()
      .then((r) => { setDomains(r.domains); if (r.domains.length > 0) setSelectedDomain(r.domains[0].name); })
      .catch(() => setDomains([{ name: 'local', displayName: 'Local (Demo Users)', type: 'local', flowType: 'client_credentials' }]));
  }, []);

  function handleDomainChange(name: string) {
    setSelectedDomain(name); setSelectedEmail(''); setPassword(''); setError(null); setShowPassword(false);
  }

  function handleUserSelect(email: string) {
    setSelectedEmail(email); setPassword(email ? DEMO_PASSWORD : ''); setError(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { token } = await api.auth.login({ email: selectedEmail, password, domain: selectedDomain });
      setToken(token);
      onLogin();
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
      setSubmitting(false);
    }
  }

  const currentDomain  = domains.find((d) => d.name === selectedDomain);
  const flowType       = currentDomain?.flowType ?? (currentDomain?.type === 'local' ? 'client_credentials' : currentDomain?.type);
  const isCredentialFlow = !flowType || flowType === 'client_credentials';
  const isLocalDomain    = selectedDomain === 'local';

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="relative text-center mb-6">
          <button type="button" onClick={toggleDebug}
            title={debugMode ? 'Debug mode on - click to disable' : 'Enable debug mode'}
            className={`absolute top-0 right-0 p-1.5 rounded-lg transition-colors ${debugMode ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}>
            <Bug size={14} />
          </button>
          <div className="text-4xl mb-2">🏦</div>
          <h1 className="text-2xl font-bold">PSP Demo</h1>
          <p className="text-gray-500 text-sm mt-1">Application Mode: Sign In</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Authentication Domain */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700">
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
              <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 animate-pulse">Loading domains…</div>
            ) : (
              <select value={selectedDomain} onChange={(e) => handleDomainChange(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                {domains.map((d) => <option key={d.name} value={d.name}>{d.displayName}</option>)}
              </select>
            )}
            {currentDomain?.alertMessage && <p className="text-xs text-amber-600 mt-0.5">{currentDomain.alertMessage}</p>}
          </div>

          {/* Redirect-based flow */}
          {!isCredentialFlow && currentDomain && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
              <p className="text-sm text-blue-800">
                <strong>{currentDomain.displayName}</strong> uses <strong>{FLOW_TYPE_LABELS[flowType ?? ''] ?? flowType}</strong>. You will be redirected to the provider to complete login.
              </p>
              <button type="button" className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                onClick={() => setError('External SSO redirect is not active in this demo build.')}>
                Sign in with {currentDomain.displayName} →
              </button>
            </div>
          )}

          {/* Client-credentials form */}
          {isCredentialFlow && (
            <>
              {isLocalDomain && debugMode && (
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    Select User
                    <Tooltip text="Pre-seeded demo users for the local domain. Select one to auto-fill credentials. Passwords are bcrypt-hashed in the database, never stored in plaintext." />
                  </label>
                  {users.length === 0 ? (
                    <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 animate-pulse">Loading users…</div>
                  ) : (
                    <select value={displayUsers.some((u) => u.email === selectedEmail) ? selectedEmail : ''} onChange={(e) => handleUserSelect(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select a user…</option>
                      {displayUsers.map((u) => (
                        <option key={u.email} value={u.email}>
                          {u.name} ({ROLE_LABELS[u.role] ?? u.role}{u.merchant ? ` · 🏬 ${u.merchant}` : ''})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {isLocalDomain && (
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    Email
                    {debugMode && <Tooltip text="Select a user above to auto-fill, or type a custom email address." />}
                  </label>
                  <input type="email" value={selectedEmail}
                    onChange={(e) => { setSelectedEmail(e.target.value); if (users.some((u) => u.email === e.target.value)) setPassword(DEMO_PASSWORD); setError(null); }}
                    placeholder="user@example.com" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              )}

              {!isLocalDomain && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={selectedEmail} onChange={(e) => { setSelectedEmail(e.target.value); setError(null); }} placeholder="user@example.com" className="w-full border rounded-lg px-3 py-2 text-sm" required />
                </div>
              )}

              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                  Password
                  <Tooltip text="Auto-filled from the demo credential store for local users. The actual password is hashed (bcrypt, 12 rounds) in MongoDB. Atlas never sees the plaintext." />
                </label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLocalDomain ? 'Auto-filled on user selection' : 'Enter password'} className="w-full border rounded-lg px-3 py-2 pr-10 text-sm" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

          {isCredentialFlow && (
            <button type="submit" disabled={!selectedEmail || !password || submitting} suppressHydrationWarning
              className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-40">
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          )}
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          {isLocalDomain && debugMode ? 'Select a user to auto-fill credentials. All local demo accounts share the same demo password.'
            : isLocalDomain ? 'Enter your credentials to sign in.'
            : isCredentialFlow ? 'Enter credentials for the selected identity provider.'
            : 'You will be redirected to complete authentication.'}
        </p>
        <div className="mt-4 text-center">
          <Link href="/" className="text-xs text-gray-400 hover:text-[#001E2B] transition-colors">← Back to Mode Selection</Link>
        </div>
      </div>
    </div>
  );
}

// ── Integration Hub (manager role) ───────────────────────────────────────────

interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderHealthStatus?: string;
  bianServiceDomain: string;
}

const TYPE_META: Record<string, { label: string; icon: LucideIcon; description: string; bianSd: string; href: string }> = {
  fraud_detection:    { label: 'Fraud Detection',    icon: ShieldAlert,   description: 'Real-time transaction scoring and fraud signals',       bianSd: 'SD-63',  href: '/system/admin/fraud-detection' },
  hrp_sanctions:      { label: 'HRP / Sanctions',    icon: ScanLine,      description: 'High-risk person and sanctions list screening',         bianSd: 'SD-13',  href: '/system/admin/hrp' },
  kyc_identity:       { label: 'KYC / Identity',     icon: UserCheck,     description: 'Customer identity verification (KYC)',                  bianSd: 'SD-53',  href: '/system/admin/kyc' },
  kyb_business:       { label: 'KYB / Business',     icon: Building2,     description: 'Merchant business entity verification (KYB)',           bianSd: 'SD-89',  href: '/system/admin/kyb' },
  aml_monitoring:     { label: 'AML Monitoring',     icon: AlertTriangle, description: 'Anti-money laundering pattern analysis',                bianSd: 'SD-99',  href: '/system/admin/aml' },
  credit_bureau:      { label: 'Credit Bureau',      icon: CreditCard,    description: 'Credit scoring and bureau checks',                      bianSd: 'SD-83',  href: '/system/admin/credit-bureau' },
  card_authorization: { label: 'Card Authorization', icon: Zap,           description: 'Card transaction authorization via payment networks',   bianSd: 'SD-15',  href: '/system/admin/card-authorization' },
  card_issuer:        { label: 'Card Issuer',        icon: KeyRound,      description: 'CVV and PIN validation from card-issuing processors',   bianSd: 'SD-88',  href: '/system/admin/card-issuer' },
};

function HealthBadge({ status }: { status?: string }) {
  if (!status || status === 'unknown') return <span className="flex items-center gap-1 text-xs text-gray-400"><Clock size={12} />Unknown</span>;
  if (status === 'ok')          return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} />Healthy</span>;
  if (status === 'degraded')    return <span className="flex items-center gap-1 text-xs text-amber-600"><AlertCircle size={12} />Degraded</span>;
  if (status === 'unreachable') return <span className="flex items-center gap-1 text-xs text-red-600"><WifiOff size={12} />Unreachable</span>;
  return null;
}

function ManagerIntegrationHub({ debugMode }: { debugMode: boolean }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken() ?? '';
    api.integrations.list(token)
      .then(d => { setIntegrations(d.integrations as unknown as Integration[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const activeByType = Object.fromEntries(
    integrations.map(i => [i.externalProviderArrangementType, i])
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Integration Hub</h2>
          <p className="text-sm text-gray-500 mt-0.5">BIAN SD-193 External Provider Arrangements · PCI DSS Req 12.8</p>
        </div>
        <Link
          href="/system/admin/integrations"
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
        >
          <Wrench size={14} />
          Manage Integrations
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading integration status...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(TYPE_META).map(([type, meta]) => {
            const active = activeByType[type];
            const Icon = meta.icon;
            return (
              <Link key={type} href={meta.href} className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                    <Icon size={20} className="text-slate-600" />
                  </div>
                  {active ? (
                    <HealthBadge status={active.externalProviderHealthStatus} />
                  ) : (
                    <span className="text-xs text-gray-400">Not configured</span>
                  )}
                </div>
                <p className="font-semibold text-gray-900 text-sm">{meta.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                {active && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-700 font-medium truncate">{active.externalProviderArrangementName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {active.externalProviderIsInternal && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">Built-in</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        active.externalProviderArrangementStatus === 'active'   ? 'bg-green-100 text-green-700' :
                        active.externalProviderArrangementStatus === 'inactive' ? 'bg-gray-100 text-gray-600' :
                        active.externalProviderArrangementStatus === 'test'     ? 'bg-blue-100 text-blue-700' :
                                                                                  'bg-red-100 text-red-700'
                      }`}>
                        {active.externalProviderArrangementStatus}
                      </span>
                    </div>
                  </div>
                )}
                {debugMode && (
                  <p className="mt-2 text-[10px] font-mono text-gray-400">{meta.bianSd} · {meta.label}</p>
                )}
              </Link>
            );
          })}

          {/* Integration Registry card */}
          <Link href="/system/admin/integrations" className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Plug size={20} className="text-slate-600" />
              </div>
              <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-mono">
                {integrations.length} registered
              </span>
            </div>
            <p className="font-semibold text-gray-900 text-sm">Integration Registry</p>
            <p className="text-xs text-gray-500 mt-0.5">Manage all external provider arrangements</p>
            {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">SD-193 · Req 12.8</p>}
          </Link>

          {/* Routing Groups card */}
          <Link href="/system/admin/routing-groups" className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Network size={20} className="text-slate-600" />
              </div>
            </div>
            <p className="font-semibold text-gray-900 text-sm">Routing Groups</p>
            <p className="text-xs text-gray-500 mt-0.5">Provider routing strategies and members</p>
            {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">SD-193 · routing portfolio</p>}
          </Link>

          {/* Audit Events card */}
          <Link href="/system/audit-events" className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Activity size={20} className="text-slate-600" />
              </div>
            </div>
            <p className="font-semibold text-gray-900 text-sm">Audit Events</p>
            <p className="text-xs text-gray-500 mt-0.5">Unified business, compliance and integration audit trail</p>
            {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">ADR-025 · Req 10.2 / 10.7</p>}
          </Link>
        </div>
      )}

      {debugMode && (
        <div className="mt-6 bg-slate-900 rounded-xl p-4 text-xs font-mono text-slate-300">
          <p className="text-slate-400 mb-2">SD-193 External Provider Arrangements, Registry snapshot</p>
          <p>Total registered: <span className="text-[#00ED64]">{integrations.length}</span></p>
          <p>Internal (built-in): <span className="text-[#00ED64]">{integrations.filter(i => i.externalProviderIsInternal).length}</span></p>
          <p>External: <span className="text-[#00ED64]">{integrations.filter(i => !i.externalProviderIsInternal).length}</span></p>
        </div>
      )}
    </>
  );
}

// ── Role dashboard ────────────────────────────────────────────────────────────

function RoleDashboard({ user, onSignOut }: { user: DecodedUser; onSignOut: () => void }) {
  const { debugMode } = useDebugMode();
  const cards  = ROLE_CARDS[user.role]  ?? [];
  const accent = ROLE_ACCENT[user.role] ?? ROLE_ACCENT.customer;

  return (
    <div className="min-h-screen bg-[#001E2B] flex flex-col">
      {/* Standalone header */}
      <header className="sticky top-0 z-20 bg-[#001E2B] border-b border-white/8 px-3 sm:px-5 h-12 flex items-center justify-between shrink-0 gap-3">
        <Link href="/system" className="flex items-center gap-2 text-[#00ED64] font-bold text-sm whitespace-nowrap hover:text-[#00ED64]/80 transition-colors">
          <span className="text-base">🏦</span>
          <span>PSP</span>
        </Link>
        <UserMenu user={user} onSignOut={onSignOut} />
      </header>

      {/* Sidebar + Content */}
      <div className="flex flex-1">
        <DemoSidebar />
        <main className="flex-1 min-w-0 bg-gray-50 pb-16 md:pb-0">
        <div className="w-full px-5 sm:px-8 lg:px-12 py-8">
          <div className="mb-6">
            <SectionHeader
              icon={LayoutGrid}
              title={`Welcome, ${user.name.split(' ')[0]}`}
              description={`Signed in as ${ROLE_LABELS[user.role] ?? user.role}`}
              debugInfo="BIAN-aligned data model · PCI DSS v4.0 controls"
            />
          </div>

          {user.role === 'manager' ? (
            <ManagerIntegrationHub debugMode={debugMode} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link key={card.href} href={card.href}
                    className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
                    <div className="mb-3">
                      <div className={`inline-flex p-2 rounded-lg ${accent.iconBg}`}>
                        <Icon size={20} className={accent.iconText} />
                      </div>
                    </div>
                    <p className="font-semibold text-gray-900 text-sm">{card.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{card.description}</p>
                    {debugMode && card.bianSd && (
                      <p className="mt-2 text-[10px] font-mono text-gray-400">{card.bianSd} · {card.pciDss}</p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Role-relevant analytics (BIAN-aligned; aggregates only — no cardholder PII) */}
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              Insights
              {debugMode && <span className="text-[10px] font-mono text-gray-400">· aggregates only · PCI DSS Req 3/7</span>}
            </h2>
            <RoleStats role={user.role} token={getToken() ?? ''} />
          </div>

          {debugMode && (
            <div className="mt-6 bg-slate-900 rounded-xl p-4 text-xs font-mono text-slate-300">
              <p className="text-slate-400 mb-2">Session context</p>
              <p>sub: <span className="text-[#00ED64]">{user.sub}</span></p>
              <p>role: <span className="text-[#00ED64]">{user.role}</span></p>
              <p>email: <span className="text-[#00ED64]">{user.email}</span></p>
            </div>
          )}
        </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function SystemPage() {
  const [user, setUser]       = useState<DecodedUser | null>(null);
  const [checked, setChecked] = useState(false);

  const checkAuth = useCallback(() => {
    const token = getToken();
    setUser(token && !isTokenExpired(token) ? decodeToken(token) : null);
    setChecked(true);
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  function signOut() {
    clearToken();
    setUser(null);
    setChecked(true);
  }

  if (!checked) return <div className="min-h-screen bg-[#001E2B]" suppressHydrationWarning />;
  if (user)    return <RoleDashboard user={user} onSignOut={signOut} />;
  return <LoginForm onLogin={checkAuth} />;
}
