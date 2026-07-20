'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScanSearch, Save, ListChecks } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../components/Tooltip';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';

// Dedicated config UI for the internal AML (Anti-Money-Laundering) monitoring engine (overrides the
// generic module editor). DATA-DRIVEN: watchlist sources + continuous-monitoring flag live in the
// capability moduleConfig; the backend /modules/aml/score endpoint evaluates them. PCI DSS Req 12.8 / Req 10.
const CAP = 'aml';
const DEFAULT_SOURCES = ['OFAC_SDN', 'FATF', 'EU_Consolidated'];

export default function AmlModulePage() {
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [sources, setSources] = useState(DEFAULT_SOURCES.join(', '));
  const [continuous, setContinuous] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    api.modules.getConfig(CAP, t)
      .then((c: unknown) => {
        const mc = ((c as { moduleConfig?: Record<string, unknown> })?.moduleConfig ?? {}) as { watchlistSources?: string[]; continuousMonitoring?: boolean };
        if (mc.watchlistSources) setSources(mc.watchlistSources.join(', '));
        if (typeof mc.continuousMonitoring === 'boolean') setContinuous(mc.continuousMonitoring);
      })
      .catch(() => { /* defaults */ })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.modules.updateConfig(CAP, {
        watchlistSources: sources.split(',').map(s => s.trim()).filter(Boolean),
        continuousMonitoring: continuous,
      }, token);
      notify('AML monitoring configuration saved', 'success');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save configuration', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="w-full px-5 sm:px-8 py-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'AML Monitoring' }]} />
      <SectionHeader icon={ScanSearch} title="AML Monitoring" description="Anti-money-laundering screening and suspicious-activity analysis." debugInfo="capability=aml · SD-99 Suspicious Activity Analysis · PCI DSS Req 12.8 / Req 10" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Watchlist sources<Tooltip text="The AML watchlist / typology sources the engine screens transactions and parties against (comma-separated). A high/critical alert is a hard block; lower alerts pass to post-initiation monitoring." /></h3>
          <label className="text-xs text-gray-600 block">Sources (comma-separated)<Tooltip text="e.g. OFAC_SDN, FATF (high-risk jurisdictions), EU_Consolidated. Used to derive the suspicious-activity alert level for a transaction." />
            <input value={sources} onChange={e => setSources(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono" />
          </label>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Monitoring mode<Tooltip text="Whether AML runs only at transaction time or continuously re-screens the customer's activity over time." /></h3>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={continuous} onChange={() => setContinuous(v => !v)} /> Continuous monitoring<Tooltip text="When enabled, AML re-evaluates the party's activity on an ongoing basis (not only at the moment of a transaction), surfacing patterns that emerge across multiple operations." />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-60">
          <Save size={14} />{saving ? 'Saving…' : 'Save configuration'}
        </button>
        <Link href="/system/audit-events?type=aml" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ListChecks size={14} /> View monitoring logs in audit events
        </Link>
      </div>
    </div>
  );
}
