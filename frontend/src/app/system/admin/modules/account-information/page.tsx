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

// Unified Account Information (AIS) module admin (v29.1): one page with "Configuration/Policies" and
// "Accounts" tabs. Config is a typed form over the AIS engine settings (with a read-only raw view);
// Accounts is the SD-66 data plane.

const CAP = 'account-information';

function AccountInfoConfigPanel() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit

  // Known AIS engine settings (mirror of backend DEFAULT_ACCOUNT_INFORMATION_CONFIG). Any other keys
  // present in the stored config are preserved on save (forward-compatible).
  const KNOWN_KEYS = ['alwaysVerifyActive', 'returnInternalBalance', 'identityCheckEnabled'];

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [alwaysVerifyActive, setAlwaysVerifyActive] = useState(true);
  const [returnInternalBalance, setReturnInternalBalance] = useState(true);
  const [identityCheckEnabled, setIdentityCheckEnabled] = useState(true);
  const [extraKeys, setExtraKeys] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.modules.getConfig(CAP, token);
        setConfig(c);
        const mc = (c?.moduleConfig as Record<string, unknown>) ?? {};
        setAlwaysVerifyActive(typeof mc.alwaysVerifyActive === 'boolean' ? mc.alwaysVerifyActive : true);
        setReturnInternalBalance(typeof mc.returnInternalBalance === 'boolean' ? mc.returnInternalBalance : true);
        setIdentityCheckEnabled(typeof mc.identityCheckEnabled === 'boolean' ? mc.identityCheckEnabled : true);
        // Keep any non-standard keys so saving the form does not drop them.
        setExtraKeys(Object.fromEntries(Object.entries(mc).filter(([k]) => !KNOWN_KEYS.includes(k))));
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // The effective moduleConfig that will be persisted (form values + preserved extras).
  const effectiveConfig: Record<string, unknown> = {
    ...extraKeys,
    alwaysVerifyActive,
    returnInternalBalance,
    identityCheckEnabled,
  };

  async function save() {
    setSaving(true);
    try {
      const updated = await api.modules.updateConfig(CAP, effectiveConfig, token);
      setConfig(updated);
      notify('Module configuration saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <>
      {!canEdit && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          Read-only: your role can view this configuration but not change it (requires <code className="font-mono text-xs">modules:manage</code>).
        </div>
      )}
      <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
        {/* Verification policies (SD-36 AIS engine) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
          <h2 className="font-semibold text-gray-800 text-sm">Verification policies</h2>
          <p className="text-xs text-gray-500 pb-2">How the built-in AIS engine verifies a PSP-registered payout account. Overrides the built-in defaults.</p>

          <ToggleRow
            label="Only active accounts pass"
            hint="A suspended or closed account is reported as not verified (dormant / closed)."
            checked={alwaysVerifyActive}
            onChange={setAlwaysVerifyActive}
          />
          <ToggleRow
            label="Return internal ledger balance"
            hint="Include the PSP internal-ledger pending / available balance in the verification response."
            checked={returnInternalBalance}
            onChange={setReturnInternalBalance}
          />
          <ToggleRow
            label="Identity check"
            hint="Match the requested account holder against the registered party (identity assurance signal)."
            checked={identityCheckEnabled}
            onChange={setIdentityCheckEnabled}
          />
        </div>

        {canEdit && (
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            <Save size={15} />{saving ? 'Saving…' : 'Save configuration'}
          </button>
        )}

        {/* Advanced: the effective moduleConfig that will be persisted (read-only, transparency). */}
        <details className="bg-white rounded-xl border border-gray-200 p-5">
          <summary className="text-sm font-semibold text-gray-800 cursor-pointer">Advanced: raw configuration</summary>
          <p className="text-xs text-gray-500 my-2">The effective <code className="font-mono">moduleConfig</code> persisted for this module. Edit via the toggles above; any non-standard keys are preserved.</p>
          <JsonView data={effectiveConfig} maxHeight="14rem" collapsed={1} />
        </details>
      </fieldset>

      {config?.moduleCallbackEndpoints !== undefined && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h2 className="font-semibold text-gray-800 text-sm">Callback endpoints</h2>
          <p className="text-xs text-gray-500">Routes this module calls back into the PSP after processing (the round-trip the linking vendor relies on).</p>
          <JsonView data={config.moduleCallbackEndpoints} maxHeight="10rem" collapsed={2} />
        </div>
      )}
    </>
  );
}

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

const TABS: ModuleTab[] = [
  { key: 'config', label: 'Configuration' },
  { key: 'accounts', label: 'Accounts' },
];

function AccountInfoModule() {
  const [tab, setTab] = useActiveTab(TABS, 'config');
  const descriptor = byCapability(CAP);
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: descriptor.label }]} />
      <SectionHeader
        icon={Landmark}
        title={`${descriptor.label}; Internal Module`}
        description="AIS validation policies plus global payout-account administration (SD-66), unified in one module surface."
        debugInfo="capability=account-information · SD-66 Payout Account Arrangement · GDPR/PSD2 · PCI Req 7 · Req 10"
      />
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'config' ? <AccountInfoConfigPanel /> : (
        <RequirePermission resource="accounts" action="view">
          <AccountsAdminPanel />
        </RequirePermission>
      )}
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
