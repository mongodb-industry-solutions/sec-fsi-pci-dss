'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, Save, ListChecks } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../components/Tooltip';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';

// Dedicated config UI for the internal HRP (High-Risk Person / Sanctions) engine (overrides the
// generic module editor). DATA-DRIVEN: screening lists + match threshold live in the capability
// moduleConfig; the backend /modules/hrp/screen endpoint evaluates them. PCI DSS.
const CAP = 'hrp';
const DEFAULT_LISTS = ['OFAC_SDN', 'EU_Consolidated', 'UN_Consolidated', 'PEP_Global'];

export default function HrpModulePage() {
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit
  const [token, setToken] = useState('');
  const [lists, setLists] = useState(DEFAULT_LISTS.join(', '));
  const [matchThreshold, setMatchThreshold] = useState(85);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    api.modules.getConfig(CAP, t)
      .then((c: unknown) => {
        const mc = ((c as { moduleConfig?: Record<string, unknown> })?.moduleConfig ?? {}) as { screeningLists?: string[]; matchThreshold?: number };
        if (mc.screeningLists) setLists(mc.screeningLists.join(', '));
        if (typeof mc.matchThreshold === 'number') setMatchThreshold(mc.matchThreshold);
      })
      .catch(() => { /* defaults */ })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.modules.updateConfig(CAP, {
        screeningLists: lists.split(',').map(s => s.trim()).filter(Boolean),
        matchThreshold: Number(matchThreshold),
      }, token);
      notify('HRP / Sanctions configuration saved', 'success');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save configuration', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="w-full px-5 sm:px-8 py-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'HRP / Sanctions' }]} />
      <SectionHeader icon={ShieldAlert} title="HRP / Sanctions" description="High-risk person / counterparty and sanctions / PEP screening." debugInfo="capability=hrp Party Data Management · PCI DSS" />

      {!canEdit && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          Read-only: your role can view this configuration but not change it (requires <code className="font-mono text-xs">modules:manage</code>).
        </div>
      )}
      <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Screening lists<Tooltip text="The sanctions / watchlist / PEP sources the engine screens the party against (comma-separated). A hit on any list is a hard block (sanctions match)." /></h3>
          <label className="text-xs text-gray-600 block">Lists (comma-separated)<Tooltip text="e.g. OFAC_SDN (US Treasury), EU_Consolidated, UN_Consolidated, PEP_Global. The party name/reference is matched against every enabled list." />
            <input value={lists} onChange={e => setLists(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono" />
          </label>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Match sensitivity<Tooltip text="How close a name must be to a listed entity to count as a hit. Higher = stricter (fewer false positives, more misses); lower = more sensitive." /></h3>
          <label className="text-xs text-gray-600 block">Match threshold (0–100)<Tooltip text="Minimum similarity score at/above which a candidate is treated as a sanctions/PEP match and the transaction is blocked." />
            <input type="number" min="0" max="100" value={matchThreshold} onChange={e => setMatchThreshold(Number(e.target.value))} className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono" />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-60">
          <Save size={14} />{saving ? 'Saving…' : 'Save configuration'}
        </button>
        <Link href="/system/audit-events?type=hrp" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ListChecks size={14} /> View screening logs in audit events
        </Link>
      </div>
      </fieldset>
    </div>
  );
}
