'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Eye, EyeOff, Bug,
  BriefcaseMedical, CreditCard, Users, BarChart3, ClipboardList, User,
  PlusCircle, Store, ClipboardCheck,
  Plug, LayoutGrid, ShieldCheck,
  Activity, Network, Landmark, ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { api, AuthUser, AuthDomain } from '../../lib/api';
import { BRAND } from '../../config/brand';
import { getToken, setToken, clearToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { DEMO_PASSWORD, ROLE_LABELS } from '../../lib/constants';
import demoRoster from '../../config/demoRoster.json';
import { Tooltip } from '../../components/Tooltip';
import { useDebugMode } from '../../lib/debugMode';
import { useDebugHint } from '../../lib/debugHint';
import { UserMenu } from '../../components/UserMenu';
import { NotificationBell } from '../../components/NotificationBell';
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
  operations_officer:  5,
  manager:             6,
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
}

const ROLE_CARDS: Record<string, DashboardCard[]> = {
  customer: [
    { label: 'Transactions',    description: 'View all your past payments and transfers, including their status and any security review.',    icon: ClipboardList,  href: '/system/payment/history' },
    { label: 'New Payment',     description: 'Pay a merchant with a saved card. Choose the merchant, amount and channel.',                    icon: PlusCircle,     href: '/system/payment' },
    { label: 'Transfer',        description: 'Send money to a saved contact, initiate a bank transfer, or create a payment link.',           icon: ArrowLeftRight, href: '/system/transfer' },
    { label: 'Payment Methods', description: 'View and manage your saved cards. Only the last 4 digits are ever displayed.',                  icon: CreditCard,     href: '/system/cards' },
    { label: 'Payout Accounts', description: 'Manage the bank accounts where you send and receive money.',                                   icon: Landmark,       href: '/system/accounts' },
    { label: 'Merchants',       description: 'Browse the merchants you can pay.',                                                            icon: Store,          href: '/system/merchant' },
    { label: 'Profile',         description: 'View and update your personal details and contact information.',                               icon: User,           href: '/system/profile' },
  ],
  level1_analyst: [
    { label: 'Cases',        description: 'Review open fraud cases. Search by case reference, email, phone or card, and escalate to L2 when needed.', icon: BriefcaseMedical, href: '/system/investigation' },
    { label: 'Transactions', description: 'Search and inspect card transactions across all customers.',                                                icon: CreditCard,       href: '/system/transactions' },
    { label: 'Users',        description: 'Look up customers by email, phone or account reference.',                                                   icon: Users,            href: '/system/users' },
    { label: 'Merchants',    description: 'Browse merchants and review their KYB status and payment activity.',                                        icon: Store,            href: '/system/merchant' },
  ],
  level2_investigator: [
    { label: 'Cases',        description: 'Approve escalations, access full customer details, and resolve cases as fraud or cleared.',  icon: BriefcaseMedical, href: '/system/investigation' },
    { label: 'Transactions', description: 'Deep-dive transaction analysis with full access to gateway and processor details.',         icon: CreditCard,       href: '/system/transactions' },
    { label: 'Users',        description: 'Full customer records and agreement detail.',                                               icon: Users,            href: '/system/users' },
    { label: 'Merchants',    description: 'Merchant due-diligence: identity, risk profile and payment activity.',                     icon: Store,            href: '/system/merchant' },
  ],
  security_auditor: [
    { label: 'Cases',          description: 'Read-only view of every fraud case and its complete audit trail.',                  icon: BriefcaseMedical, href: '/system/investigation' },
    { label: 'Transactions',   description: 'Full transaction audit view, all fields visible, no modifications permitted.',     icon: CreditCard,       href: '/system/transactions' },
    { label: 'Users',          description: 'Customer and staff account review: authentication records and role assignments.',   icon: Users,            href: '/system/users' },
    { label: 'Audit Log',      description: 'Security event log: who did what and when, across all cases and users.',           icon: BarChart3,        href: '/system/audit' },
    { label: 'Audit Events',   description: 'Unified activity log across payments, compliance checks and integrations.',        icon: Activity,         href: '/system/audit-events' },
    { label: 'Data Integrity', description: 'Check that all records are consistent and no data is missing or duplicated.',      icon: ShieldCheck,      href: '/system/integrity' },
    { label: 'Merchant',       description: 'Merchant compliance and lifecycle audit across the portfolio.',                    icon: Store,            href: '/system/merchant' },
  ],
  merchant_officer: [
    { label: 'Review Queue', description: 'Approve or reject pending merchant applications.',                         icon: ClipboardCheck, href: '/system/merchant/review' },
    { label: 'All Merchants',description: 'Full merchant portfolio with KYB status, activity and history.',           icon: Store,          href: '/system/merchant' },
    { label: 'My Profile',   description: 'Manage your profile and contact details.',                                 icon: User,           href: '/system/profile' },
  ],
  operations_officer: [
    { label: 'Modules',       description: 'Administer the internal capability engines (card issuer, AIS, FDS, AML, HRP...) and their business policies.', icon: LayoutGrid, href: '/system/admin/modules' },
    { label: 'Cards',         description: 'Global cardholder card administration: register, edit, activate/suspend and revoke saved cards.',        icon: CreditCard, href: '/system/admin/modules/card-issuer?tab=cards' },
    { label: 'Payout Accounts', description: 'Global payout-account administration: create, edit and close accounts. IBAN stays encrypted.',        icon: Landmark,   href: '/system/admin/modules/account-information?tab=accounts' },
    { label: 'Audit Events',  description: 'Follow how rules and configurations behave: card validation and connected-module outcomes (approved/rejected/error).', icon: Activity,   href: '/system/audit-events' },
  ],
  manager: [],
};

const ROLE_ACCENT: Record<string, { iconBg: string; iconText: string; badge: string }> = {
  customer:            { iconBg: 'bg-blue-50',   iconText: 'text-blue-600',   badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  level1_analyst:      { iconBg: 'bg-amber-50',  iconText: 'text-amber-600',  badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  level2_investigator: { iconBg: 'bg-orange-50', iconText: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  security_auditor:    { iconBg: 'bg-purple-50', iconText: 'text-purple-600', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  merchant_officer:    { iconBg: 'bg-teal-50',   iconText: 'text-teal-600',   badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  operations_officer:  { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  manager:             { iconBg: 'bg-slate-100', iconText: 'text-slate-600',  badge: 'bg-slate-50 text-slate-700 border-slate-200' },
};

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const { debugMode, toggleDebug } = useDebugMode();
  const { pulsing, dismissHint } = useDebugHint();
  const showPulse = pulsing && !debugMode;
  const [users, setUsers]       = useState<AuthUser[]>([]);
  const [domains, setDomains]   = useState<AuthDomain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('leafypay');
  const [selectedEmail, setSelectedEmail]   = useState('');
  const [password, setPassword]             = useState('');
  const [showPassword, setShowPassword]     = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  // The API already returns the curated roster (config/demoRoster.json criteria) in a deterministic
  // order shared with the simulator. We only group by role for display; no hardcoded user cap.
  const displayUsers = useMemo(
    () => [...users].sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99)),
    [users],
  );

  useEffect(() => {
    setSelectedEmail(''); setPassword(''); setSubmitting(false); setError(null);
  }, []);

  useEffect(() => {
    api.system.users(demoRoster.login).then((r) => setUsers(r.users)).catch(() => {});
    api.auth.domains()
      .then((r) => { setDomains(r.domains); if (r.domains.length > 0) setSelectedDomain(r.domains[0].name); })
      .catch(() => setDomains([{ name: 'leafypay', displayName: 'Leafy Pay', type: 'local', flowType: 'client_credentials' }]));
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
  // The platform realm, by name. `local` is still accepted so a session started before the rename keeps
  // showing the credential form rather than a redirect button.
  const isLocalDomain    = selectedDomain === 'leafypay' || selectedDomain === 'local';

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="relative text-center mb-6">
          <Tooltip text={debugMode
            ? 'Debug mode is on: a ready-made user is offered for each role so you can sign in with one click, and some screens show extra notes explaining what you are looking at. Click to turn it off.'
            : 'Turn on debug mode. It offers a ready-made user for each role, so you can sign in with one click instead of typing credentials, and it adds short explanations on some screens to help you understand what each part of the system does.'}>
            <button type="button" onClick={() => { dismissHint(); toggleDebug(); }}
              aria-label={debugMode ? 'Disable debug mode' : 'Enable debug mode'}
              className={`absolute top-0 right-0 p-1.5 rounded-lg transition-colors ${
                debugMode ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                : showPulse ? 'debug-hint-pulse'
                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}>
              <Bug size={14} />
            </button>
          </Tooltip>

          <div className="text-4xl mb-2"> <img src="/app-icon.png" alt={`${BRAND.full} Icon`} className="w-20 h-20 mx-auto" /> </div>
          <h1 className="text-2xl font-bold">{BRAND.primary} {BRAND.secondary}</h1>
          <p className="text-gray-500 text-sm mt-1">Application Mode: Sign In</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Authentication Domain */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700">
                Authentication Domain
                <Tooltip text="The domain decides how you are signed in and who manages the accounts. Pick the one your account belongs to." />
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
                onClick={() => setError('External SSO redirect is not active in this build.')}>
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
                    <Tooltip text="Ready-made accounts, one per role, so you can see the platform through different eyes. Pick one and its credentials are filled in for you." />
                  </label>
                  {users.length === 0 ? (
                    <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 animate-pulse">Loading users…</div>
                  ) : (
                    <select value={displayUsers.some((u) => u.email === selectedEmail) ? selectedEmail : ''} onChange={(e) => handleUserSelect(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select a user…</option>
                      {displayUsers.map((u) => (
                        <option key={u.email} value={u.email}>
                          {u.name} ({ROLE_LABELS[u.role] ?? u.role}{u.merchant ? ` · 🏬 ${u.merchant.name}` : ''})
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
                    <Tooltip text={<>
                      Your email address is also your username: it is what identifies your account.
                      {' '}Short on time? Turn on debug mode
                      {' '}<Bug size={11} className="mx-0.5 inline align-[-1px] text-amber-400" />
                      {' '}and pick a ready-made user for any role instead of typing credentials.
                    </>} />
                  </label>
                  <input type="email" value={selectedEmail}
                    onChange={(e) => { setSelectedEmail(e.target.value); if (users.some((u) => u.email === e.target.value)) setPassword(DEMO_PASSWORD); setError(null); }}
                    placeholder="user@example.com" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              )}

              {!isLocalDomain && (
                <div>
                  <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                    Email
                    <Tooltip text="Your email address is also your username: it is what identifies your account." />
                  </label>
                  <input type="email" value={selectedEmail} onChange={(e) => { setSelectedEmail(e.target.value); setError(null); }} placeholder="user@example.com" className="w-full border rounded-lg px-3 py-2 text-sm" required />
                </div>
              )}

              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                  Password
                  <Tooltip text="Your secret key. Never share it with anyone." />
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

        {currentDomain?.selfRegistration && (
          <p className="mt-3 text-xs text-gray-500 text-center">
            Don&apos;t have an account?{' '}
            <Link href={`/auth/register?domain=${encodeURIComponent(selectedDomain)}`} className="font-semibold text-[#001E2B] hover:text-[#00684A] underline">
              Register
            </Link>
          </p>
        )}

        <p className="mt-4 text-xs text-gray-400 text-center">
          {isLocalDomain && debugMode ? 'Select a user to fill in their credentials. Every preloaded account shares the same password.'
            : isLocalDomain ? 'Enter your credentials to sign in.'
            : isCredentialFlow ? 'Enter the credentials managed by the selected domain.'
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


function ManagerIntegrationHub({ debugMode }: { debugMode: boolean }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  useEffect(() => {
    const token = getToken() ?? '';
    api.integrations.list(token)
      .then(d => setIntegrations(d.integrations as unknown as Integration[]))
      .catch(() => {});
  }, []);

  // Primary admin sections ; each is an independent area. Audit Events sits under
  // /system; Modules, Providers and Groups under /system/admin.
  const MAIN_CARDS: { label: string; description: string; icon: LucideIcon; href: string; debug: string }[] = [
    { label: 'Audit Events', description: 'Unified business, compliance and integration audit trail.', icon: Activity,   href: '/system/audit-events',           debug: 'ADR-025' },
    { label: 'Modules',      description: 'Internal capability engines (scoring, screening) and their config.', icon: LayoutGrid, href: '/system/admin/modules',          debug: 'ADR-029 · internal modules' },
    { label: 'Providers',    description: 'External provider arrangements; register, route and monitor.', icon: Plug,       href: '/system/admin/providers',        debug: '' },
    { label: 'Groups',       description: 'Provider categories and routing groups; activate built-ins or add custom groups.', icon: Network,    href: '/system/admin/providers/groups', debug: 'routing portfolio' },
  ];

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Integration Hub</h2>
        <p className="text-sm text-gray-500 mt-0.5">External Provider Arrangements · PCI DSS</p>
      </div>

      {/* Primary sections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MAIN_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href} className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                  <Icon size={20} className="text-slate-600" />
                </div>
                {card.href === '/system/admin/providers' && (
                  <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-mono">{integrations.length} registered</span>
                )}
              </div>
              <p className="font-semibold text-gray-900 text-sm">{card.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
              {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">{card.debug}</p>}
            </Link>
          );
        })}
      </div>

      {debugMode && (
        <div className="mt-6 bg-slate-900 rounded-xl p-4 text-xs font-mono text-slate-300">
          <p className="text-slate-400 mb-2">External Provider Arrangements, Registry snapshot</p>
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
          <span className="text-base"><img src="/app-icon.png" alt={`${BRAND.full} Icon`} className="w-9 h-9 mx-auto" /> </span>
          <span className="text-[#FFFFFF]">{BRAND.primary}</span><span>{BRAND.secondary}</span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
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
                  </Link>
                );
              })}
            </div>
          )}

          {/* Role-relevant analytics (BIAN-aligned; aggregates only; no cardholder PII) */}
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              Insights
              {debugMode && <span className="text-[10px] font-mono text-gray-400">· aggregates only · PCI DSS</span>}
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
