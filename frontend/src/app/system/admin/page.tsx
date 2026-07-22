'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldAlert, ScanLine, UserCheck, Building2, AlertTriangle, CreditCard,
  CheckCircle2, AlertCircle, Clock, WifiOff, Wrench, Zap, KeyRound, Boxes, Landmark, Send,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { useDebugMode } from '../../../lib/debugMode';
import { useEffectivePermissions } from '../../../lib/permissions';
import { CAPABILITY_LIST, type CapabilityDescriptor } from '../../../config/capabilities';

interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderHealthStatus?: string;
  externalProviderLastHealthCheckAt?: string;
  bianServiceDomain: string;
}

// Provider-admin tiles for the manager view (SD-193 external provider arrangements). Keyed by
// externalProviderArrangementType; each links to the provider admin folder.
const TYPE_META: Record<string, { label: string; icon: LucideIcon; description: string; bianSd: string; href: string }> = {
  fraud_detection:   { label: 'Fraud Detection',    icon: ShieldAlert,  description: 'Real-time transaction scoring and fraud signals', bianSd: 'SD-63',  href: '/system/admin/fraud-detection' },
  hrp_sanctions:     { label: 'HRP / Sanctions',    icon: ScanLine,     description: 'High-risk person and sanctions list screening',   bianSd: 'SD-13',  href: '/system/admin/hrp' },
  kyc_identity:      { label: 'KYC / Identity',     icon: UserCheck,    description: 'Customer identity verification (KYC)',            bianSd: 'SD-53',  href: '/system/admin/kyc' },
  kyb_business:      { label: 'KYB / Business',     icon: Building2,    description: 'Merchant business entity verification (KYB)',     bianSd: 'SD-89',  href: '/system/admin/kyb' },
  aml_monitoring:    { label: 'AML Monitoring',     icon: AlertTriangle, description: 'Anti-money laundering pattern analysis',         bianSd: 'SD-99',  href: '/system/admin/aml' },
  credit_bureau:     { label: 'Credit Bureau',      icon: CreditCard,   description: 'Credit scoring and bureau checks',                bianSd: 'SD-83',  href: '/system/admin/credit-bureau' },
  card_authorization: { label: 'Card Authorization', icon: Zap,         description: 'Card transaction authorization via payment networks', bianSd: 'SD-15', href: '/system/admin/card-authorization' },
  card_issuer:       { label: 'Card Issuer',        icon: KeyRound,     description: 'CVV and PIN validation from card-issuing processors', bianSd: 'SD-88', href: '/system/admin/card-issuer' },
};

// Icon per capability for the operations-officer module grid (module admin, not provider admin).
// Reuses the manager tiles' icons where they overlap; falls back to a generic module icon.
const MODULE_ICON: Record<string, LucideIcon> = {
  fds: ShieldAlert,
  aml: AlertTriangle,
  hrp: ScanLine,
  kyc: UserCheck,
  'credit-bureau': CreditCard,
  kyb: Building2,
  'card-authorization': Zap,
  'card-issuer': KeyRound,
  'account-information': Landmark,
  'payment-initiation': Send,
  vop: UserCheck,
};

function HealthBadge({ status }: { status?: string }) {
  if (!status || status === 'unknown') return <span className="flex items-center gap-1 text-xs text-gray-400"><Clock size={12} />Unknown</span>;
  if (status === 'ok')          return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} />Healthy</span>;
  if (status === 'degraded')    return <span className="flex items-center gap-1 text-xs text-amber-600"><AlertCircle size={12} />Degraded</span>;
  if (status === 'unreachable') return <span className="flex items-center gap-1 text-xs text-red-600"><WifiOff size={12} />Unreachable</span>;
  return null;
}

export default function AdminDashboardPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const { debugMode } = useDebugMode();
  const { can, loading: permsLoading } = useEffectivePermissions();

  // manager owns provider CRUD; operations_officer administers internal modules (providers read-only).
  const canManageProviders = can('providers', 'manage');

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
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        {/* Wait for permissions before rendering role-specific header/body: can() is default-deny
            while permissions load, which would briefly flash the wrong (operations-officer) view. */}
        {!permsLoading && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {canManageProviders ? 'Integration Hub' : 'Internal Modules'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {canManageProviders
                  ? 'BIAN SD-193 External Provider Arrangements · PCI DSS Req 12.8'
                  : 'Internal module administration (config + data) · provider status shown read-only'}
              </p>
            </div>
            {canManageProviders && (
              <Link
                href="/system/admin/providers"
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
              >
                <Wrench size={14} />
                Manage Integrations
              </Link>
            )}
          </div>
        )}

        {loading || permsLoading ? (
          <div className="text-center py-12 text-gray-400">Loading integration status...</div>
        ) : canManageProviders ? (
          <ProviderGrid activeByType={activeByType} debugMode={debugMode} />
        ) : (
          <ModuleGrid activeByType={activeByType} debugMode={debugMode} />
        )}

        {debugMode && (
          <div className="mt-6 bg-slate-900 rounded-xl p-4 text-xs font-mono text-slate-300">
            <p className="text-slate-400 mb-2">SD-193 External Provider Arrangements, Registry snapshot</p>
            <p>Total registered: <span className="text-[#00ED64]">{integrations.length}</span></p>
            <p>Internal (built-in): <span className="text-[#00ED64]">{integrations.filter(i => i.externalProviderIsInternal).length}</span></p>
            <p>External: <span className="text-[#00ED64]">{integrations.filter(i => !i.externalProviderIsInternal).length}</span></p>
          </div>
        )}
      </main>
    </div>
  );
}

// Manager view: provider-admin tiles (unchanged behavior).
function ProviderGrid({ activeByType, debugMode }: { activeByType: Record<string, Integration>; debugMode: boolean }) {
  return (
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
    </div>
  );
}

// Operations-officer view: one card per internal module (config + data), from the SAME capability
// registry the /system/admin/modules index uses. Provider status is READ-ONLY here (no CRUD).
function ModuleGrid({ activeByType, debugMode }: { activeByType: Record<string, Integration>; debugMode: boolean }) {
  const modules: CapabilityDescriptor[] = CAPABILITY_LIST.filter((c) => c.hasModule);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {modules.map((cap) => {
        const active = activeByType[cap.providerType];
        const external = active && !active.externalProviderIsInternal;
        const Icon = MODULE_ICON[cap.capability] ?? Boxes;
        return (
          <Link
            key={cap.capability}
            href={`/system/admin/modules/${cap.capability}`}
            className="group block bg-white rounded-xl border p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Icon size={20} className="text-slate-600" />
              </div>
              {external ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium border border-amber-200">
                  External: {active.externalProviderArrangementName}
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">
                  Built-in / internal
                </span>
              )}
            </div>

            <p className="font-semibold text-gray-900 text-sm">{cap.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{cap.description}</p>

            {external && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertCircle size={12} /> Managed externally
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">Built-in administration is disabled while an external provider owns this capability.</p>
              </div>
            )}

            {debugMode && (
              <p className="mt-2 text-[10px] font-mono text-gray-400">{cap.bianServiceDomain} · capability={cap.capability}</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
