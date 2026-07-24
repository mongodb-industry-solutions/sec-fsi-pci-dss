'use client';
// v31: KYB built-in module page (SD-89). Two tabs: Configuration (built-in engine policy incl. the
// §4.0 decisionMode) and Administration (review/correct merchants + beneficial owners). Configuration
// is gated by modules:manage; Administration by merchants:view/manage (SoD: data resource, not modules).
import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Building2, Save } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../components/Tooltip';
import { Pagination } from '../../../../../components/Pagination';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { ModuleTabsBar, useActiveTab } from '../_components/ModuleTabs';

const CAP = 'kyb';
const DECISION_MODES = ['manual', 'automated', 'assisted'];
const TABS = [{ key: 'config', label: 'Configuration' }, { key: 'admin', label: 'Administration' }];

export default function KybModulePage() {
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'KYB (Merchant Onboarding)' }]} />
      <SectionHeader icon={Building2} title="KYB — Know Your Business" description="Merchant onboarding verification engine and the KYB administration workbench." debugInfo="capability=kyb · SD-89 Merchant Relations · FATF/4th AMLD UBO · PCI Req 7/12.8" />
      <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
        <KybTabs />
      </Suspense>
    </div>
  );
}

function KybTabs() {
  const { can } = useEffectivePermissions();
  const [tab, setTab] = useActiveTab(TABS, 'config');
  const [token, setToken] = useState('');
  useEffect(() => { setToken(getToken() ?? ''); }, []);
  return (
    <>
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'config' ? <KybConfig token={token} canEdit={can('modules', 'manage')} /> : <KybAdmin token={token} canView={can('merchants', 'view')} />}
    </>
  );
}

function KybConfig({ token, canEdit }: { token: string; canEdit: boolean }) {
  const notify = useNotify();
  const [cfg, setCfg] = useState<{ decisionMode?: string; dueDiligenceLevel?: string; uboDisclosureThreshold?: number; pepScreeningIncluded?: boolean }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.modules.getConfig(CAP, token)
      .then((c: unknown) => setCfg(((c as { moduleConfig?: Record<string, unknown> })?.moduleConfig ?? {}) as never))
      .catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true);
    try { await api.modules.updateConfig(CAP, cfg as Record<string, unknown>, token); notify('KYB configuration saved', 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      {!canEdit && <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">Read-only: editing requires <code className="font-mono text-xs">modules:manage</code>.</div>}
      <fieldset disabled={!canEdit} className="grid grid-cols-1 lg:grid-cols-2 gap-5 border-0 p-0 m-0 min-w-0">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Decision mode<Tooltip text="How an onboarding process resolves. manual: chain produces evidence, an officer decides. automated: rules auto-resolve within thresholds; edge cases escalate. assisted: rules/AI recommend, a human confirms (HITL). Sanctions/PEP hits never auto-approve. Unset → manual (fail-safe)." /></h3>
          <select value={cfg.decisionMode ?? 'manual'} onChange={(e) => setCfg({ ...cfg, decisionMode: e.target.value })} className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {DECISION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="text-xs text-gray-500">The PSP owns this policy; the provider only returns evidence. Auto-approve is capped at low risk with no sanctions/PEP hit.</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Due diligence<Tooltip text="Built-in KYB engine policy: CDD depth, UBO disclosure threshold (FATF 25%) and whether PEP screening is included." /></h3>
          <label className="text-xs text-gray-600 block">UBO disclosure threshold (%)
            <input type="number" min={0} max={100} value={cfg.uboDisclosureThreshold ?? 25} onChange={(e) => setCfg({ ...cfg, uboDisclosureThreshold: Number(e.target.value) })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={cfg.pepScreeningIncluded ?? true} onChange={(e) => setCfg({ ...cfg, pepScreeningIncluded: e.target.checked })} /> PEP screening included</label>
        </div>
      </fieldset>
      {canEdit && <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium disabled:opacity-60"><Save size={14} />{saving ? 'Saving…' : 'Save configuration'}</button>}
    </div>
  );
}

function KybAdmin({ token, canView }: { token: string; canView: boolean }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.merchants.list({ status: status || undefined, risk: risk || undefined, name: name || undefined, page, limit }, token);
      setRows(r.results); setTotal(r.total);
    } catch { /* handled by empty state */ }
  }, [token, status, risk, name, page, limit]);
  useEffect(() => { void load(); }, [load]);

  if (!canView) return <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">Your role cannot view merchant administration (requires <code className="font-mono text-xs">merchants:view</code>).</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="Search name…" value={name} onChange={(e) => { setPage(1); setName(e.target.value); }} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>{['under_review', 'agreed', 'active', 'suspended', 'rejected', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={risk} onChange={(e) => { setPage(1); setRisk(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All risk</option>{['low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="py-2.5 px-4">Merchant</th><th className="py-2.5 px-4 hidden sm:table-cell">MCC</th><th className="py-2.5 px-4">Status</th><th className="py-2.5 px-4 hidden sm:table-cell">Risk</th><th className="py-2.5 px-4"></th>
          </tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={String(m.merchantAgreementInstanceReference)} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2.5 px-4 font-medium text-gray-900">{String(m.merchantName)}</td>
                <td className="py-2.5 px-4 hidden sm:table-cell text-gray-600">{String(m.merchantCategoryCode ?? '')}</td>
                <td className="py-2.5 px-4">{String(m.merchantAgreementStatus)}</td>
                <td className="py-2.5 px-4 hidden sm:table-cell">{String(m.merchantRiskCategory ?? '')}</td>
                <td className="py-2.5 px-4 text-right"><Link href={`/system/admin/modules/kyb/${String(m.merchantAgreementInstanceReference)}`} className="text-[#016BF8] hover:underline">Review →</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">No merchants match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / limit))} total={total} limit={limit} onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="merchants" />
    </div>
  );
}
