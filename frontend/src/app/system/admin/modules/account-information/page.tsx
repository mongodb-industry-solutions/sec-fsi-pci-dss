'use client';
import { Suspense, useEffect, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../components/RequirePermission';
import { JsonEditor } from '../../../../../components/json/JsonEditor';
import { JsonView } from '../../../../../components/json/JsonView';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { byCapability } from '../../../../../config/capabilities';
import { AccountsAdminPanel } from '../_components/AccountsAdminPanel';
import { ModuleTabsBar, useActiveTab, type ModuleTab } from '../_components/ModuleTabs';

// Unified Account Information (AIS) module admin (v29.1): one page with "Configuration/Policies" and
// "Accounts" tabs. Config uses the generic engine-config JSON editor; Accounts is the SD-66 data plane.

const CAP = 'account-information';

function AccountInfoConfigPanel() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.modules.getConfig(CAP, token);
        setConfig(c);
        setText(JSON.stringify((c?.moduleConfig as Record<string, unknown>) ?? {}, null, 2));
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const invalid = (() => { try { if (text.trim()) JSON.parse(text); return false; } catch { return true; } })();

  async function save() {
    if (invalid) return;
    setSaving(true);
    try {
      const moduleConfig = text.trim() ? JSON.parse(text) : {};
      const updated = await api.modules.updateConfig(CAP, moduleConfig, token);
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
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">Engine configuration <code className="font-mono text-xs text-gray-500">moduleConfig</code></h2>
        <p className="text-xs text-gray-500">Thresholds / rules used by the internal engine; overrides the built-in defaults.</p>
        <JsonEditor value={text} onChange={setText} readOnly={!canEdit} minHeight="10rem" maxHeight="22rem" error={invalid ? 'Invalid JSON' : null} />
        {canEdit && (
          <button onClick={save} disabled={saving || invalid}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            <Save size={15} />{saving ? 'Saving…' : 'Save configuration'}
          </button>
        )}
      </div>

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

const TABS: ModuleTab[] = [
  { key: 'config', label: 'Configuration / Policies' },
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
      {tab === 'config' ? <AccountInfoConfigPanel /> : <AccountsAdminPanel />}
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
