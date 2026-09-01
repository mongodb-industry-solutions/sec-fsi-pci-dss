'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  LogIn, ArrowLeft,
  BriefcaseMedical, CreditCard, Users, BarChart3, ClipboardList, User,
  PlusCircle, Store, ClipboardCheck,
  Plug, LayoutGrid, ShieldCheck,
  Activity, Network, Landmark, ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import { BRAND } from '../../config/brand';
import { getToken, clearToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/constants';
import { useDebugMode } from '../../lib/debugMode';
import { UserMenu } from '../../components/UserMenu';
import { NotificationBell } from '../../components/NotificationBell';
import { DemoSidebar, MobileBottomNav } from '../../components/DemoSidebar';
import { RoleStats } from '../../components/dashboard/RoleStats';
import { SectionHeader } from '../../components/SectionHeader';

type DecodedUser = NonNullable<ReturnType<typeof decodeToken>>;

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

function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // The callback route can only redirect, so it reports a failed exchange by query string.
  useEffect(() => {
    const reported = new URLSearchParams(window.location.search).get('signin_error');
    if (reported) setError(reported);
  }, []);

  return (
    <div className="min-h-screen bg-[#001E2B] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2"> <img src="/app-icon.png" alt={`${BRAND.full} Icon`} className="w-20 h-20 mx-auto" /> </div>
          <h1 className="text-2xl font-bold">{BRAND.primary} {BRAND.secondary}</h1>
          <p className="text-gray-500 text-sm mt-1">Application Mode: Sign In</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <a
          href="/api/auth/login"
          onClick={() => setRedirecting(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#001E2B] py-2.5 font-semibold text-[#00ED64] transition-colors hover:bg-[#00ED64] hover:text-[#001E2B]"
        >
          <LogIn size={16} />
          {redirecting ? 'Redirecting...' : 'Sign in'}
        </a>

        <p className="mt-4 text-xs text-gray-400 text-center">
          You will be redirected to the identity service to sign in. Your credentials are never entered here.
        </p>
        <div className="mt-4 text-center">
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-[#001E2B] transition-colors">
            <ArrowLeft size={12} />
            Back to Mode Selection
          </Link>
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
  return <LoginForm />;
}
