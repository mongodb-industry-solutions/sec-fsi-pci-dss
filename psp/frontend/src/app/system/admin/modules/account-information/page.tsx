'use client';
import { Suspense, useEffect, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../components/RequirePermission';
import { JsonView } from '../../../../../components/json/JsonView';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { byCapability } from '../../../../../config/capabilities';
import { AccountsAdminPanel } from '../_components/AccountsAdminPanel';
import { ModuleTabsBar, useActiveTab, type ModuleTab } from '../_components/ModuleTabs';

// The provider's PAYOUT ACCOUNTS: where a customer wants money sent.
//
// There is no configuration here any more (v37 P12). Reading an account and confirming its funds are the
// servicing institution's answers, given over its own Open Banking endpoints, and the rules behind them are
// administered in the bank's own app. What this page administers is the provider's own record, which points at
// an account the bank holds rather than being one.
// Accounts is the data plane.

const CAP = 'account-information';
// A labelled on/off row (app-style toggle) used by the AIS verification policies.
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 border-b last:border-0 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
      </span>
      <span className="relative shrink-0 mt-0.5">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block w-10 h-6 rounded-full bg-gray-300 peer-checked:bg-[#00684A] transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

// v37: the configuration tab is gone. What a third party may read from an account is the BANK's rule, set in
// the bank's own app. What is left here is the provider's own linked account records.
const TABS: ModuleTab[] = [
  { key: 'accounts', label: 'Accounts' },
];

function AccountInfoModule() {
  const [tab, setTab] = useActiveTab(TABS, 'accounts');
  const descriptor = byCapability(CAP);
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: descriptor.label }]} />
      <SectionHeader
        icon={Landmark}
        title={`${descriptor.label}; Internal Module`}
        description="AIS validation policies plus global payout-account administration, unified in one module surface."
        debugInfo="capability=account-information Payout Account Arrangement · GDPR/PSD2 · PCI DSS"
      />
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      <RequirePermission resource="accounts" action="view">
        <AccountsAdminPanel />
      </RequirePermission>
    </div>
  );
}

export default function AccountInfoModulePage() {
  return (
    <RequirePermission resource="modules" action="view">
      <Suspense fallback={<div className="w-full px-5 py-8 text-sm text-gray-400">Loading…</div>}>
        <AccountInfoModule />
      </Suspense>
    </RequirePermission>
  );
}
