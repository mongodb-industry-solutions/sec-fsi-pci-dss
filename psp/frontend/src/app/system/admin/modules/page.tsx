'use client';
import Link from 'next/link';
import { Boxes, KeyRound, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { CAPABILITY_LIST } from '../../../../config/capabilities';
import { CORE_ADMIN_MODULES, MODULE_TYPE_LABEL, type ModuleType } from '../../../../config/adminModules';
import { useEffectivePermissions } from '../../../../lib/permissions';

import { serviceDomainLabel } from '../../../../lib/serviceDomain';
const DOMAIN_LABEL: Record<string, string> = {
  fraud: 'Fraud & Financial Crime',
  customer: 'Customer & Business Due Diligence',
  gateway: 'Card / Payments',
};

// DISPLAY grouping only. KYB is owned by the `gateway` module (merchant data ownership / callback
// routing / §10 matrix stay unchanged), but for the operator it is an onboarding due-diligence sibling of
// KYC . So group it next to KYC under "Customer & Business Due Diligence" without touching its
// moduleDomain. This override does not affect the backend or the config route (/modules/kyb/config).
const displayDomain = (c: { capability: string; moduleDomain: string | null }): string | null =>
  c.capability === 'kyb' ? 'customer' : c.moduleDomain;

// §2.6: every module entry shows whether it is PSP Core or a replaceable Built-in Provider.
function ModuleTypeBadge({ type }: { type: ModuleType }) {
  const isCore = type === 'core';
  const cls = isCore
    ? 'bg-[#00684A]/10 text-[#00684A] border-[#00684A]/20'
    : 'bg-[#016BF8]/10 text-[#016BF8] border-[#016BF8]/20';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {MODULE_TYPE_LABEL[type]}
    </span>
  );
}

export default function ModulesIndexPage() {
  const { can, loading: permsLoading } = useEffectivePermissions();
  const byDomain = (['fraud', 'customer', 'gateway'] as const).map((d) => ({
    domain: d,
    items: CAPABILITY_LIST.filter((c) => c.hasModule && displayDomain(c) === d),
  }));

  // SoD (PCI DSS): the "domain" core module administers Auth Domains , which is the manager's
  // remit, not operations_officer's. Show it only to roles that hold authDomains access. Wait for
  // permissions to load (can() is default-deny meanwhile) to avoid the module flickering in on cold load.
  const coreModules = permsLoading
    ? []
    : CORE_ADMIN_MODULES.filter((m) => (m.key === 'domain' ? can('authDomains', 'view') : true));

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Boxes}
        title="Internal Modules"
        description="All configurable modules: PSP Core modules and Built-in Provider engines (replaceable by an external vendor, internal-first)."
        debugInfo="§2.6 module-type label · ADR-029 · capabilityModuleConfiguration · PCI DSS"
      />

      {/* PSP core modules (configurable core behavior, not provider adapters). */}
      {coreModules.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Core</h3>
        {coreModules.map((m) => (
          <Link
            key={m.key}
            href={m.href}
            className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <KeyRound size={18} className="text-[#001E2B]" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800 text-sm">{m.label}</p>
                    <ModuleTypeBadge type={m.moduleType} />
                  </div>
                  <p className="text-xs text-gray-500">{m.description}</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </div>
          </Link>
        ))}
      </div>
      )}

      {byDomain.map(({ domain, items }) => (
        <div key={domain} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{DOMAIN_LABEL[domain]}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((c) => (
              <Link
                key={c.capability}
                href={`/system/admin/modules/${c.capability}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
                      <ModuleTypeBadge type="built-in-provider" />
                    </div>
                    <p className="text-xs text-gray-500">{serviceDomainLabel(c.bianServiceDomain)}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
