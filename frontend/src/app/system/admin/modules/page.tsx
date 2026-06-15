'use client';
import Link from 'next/link';
import { Boxes, KeyRound, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { CAPABILITY_LIST } from '../../../../config/capabilities';

const DOMAIN_LABEL: Record<string, string> = {
  fraud: 'Fraud & Financial Crime',
  customer: 'Customer Due Diligence',
  gateway: 'Card / Payments',
};

export default function ModulesIndexPage() {
  const byDomain = (['fraud', 'customer', 'gateway'] as const).map((d) => ({
    domain: d,
    items: CAPABILITY_LIST.filter((c) => c.hasModule && c.moduleDomain === d),
  }));

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Boxes}
        title="Internal Modules"
        description="Built-in engines that implement each capability when no external vendor is active (internal-first)."
        debugInfo="ADR-029 · capabilityModuleConfiguration · PCI DSS Req 12.8"
      />

      {/* Internal module without a Provider counterpart */}
      <Link
        href="/system/admin/modules/domains"
        className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-[#001E2B]/30 hover:shadow-md transition-all"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KeyRound size={18} className="text-[#001E2B]" />
            <div>
              <p className="font-semibold text-gray-800 text-sm">Auth Domains</p>
              <p className="text-xs text-gray-500">Authentication-domain registry; full CRUD (BIAN SD-16)</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-400" />
        </div>
      </Link>

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
                    <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
                    <p className="text-xs text-gray-500">{c.bianServiceDomain}</p>
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
