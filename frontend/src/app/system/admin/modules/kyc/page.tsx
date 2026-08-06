'use client';
// v31: KYC built-in module page (SD-53). Two tabs: Configuration (built-in engine policy incl. the
// §4.0 decisionMode) and Administration (review/correct KYC-completed customers). Configuration gated
// by modules:manage; Administration by customers:view/manage (SoD: data resource, not modules).
import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { UserCheck, Save, ArrowRight, Search, X } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../components/Tooltip';
import { Pagination } from '../../../../../components/Pagination';
import { LoadingIndicator } from '../../../../../components/LoadingIndicator';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useDebugMode } from '../../../../../lib/debugMode';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { ModuleTabsBar, useActiveTab } from '../_components/ModuleTabs';

const CAP = 'kyc';
const DECISION_MODES = ['manual', 'automated', 'assisted'];
const TABS = [{ key: 'config', label: 'Configuration' }, { key: 'admin', label: 'Administration' }];

export default function KycModulePage() {
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'KYC (Customer Onboarding)' }]} />
      <SectionHeader icon={UserCheck} title="KYC: Know Your Customer" description="Customer onboarding verification engine and the KYC administration workbench." debugInfo="capability=kyc · SD-53 Customer Agreement · PCI Req 7/8/10/12.8" />
      <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
        <KycTabs />
      </Suspense>
    </div>
  );
}

function KycTabs() {
  const { can } = useEffectivePermissions();
  const [tab, setTab] = useActiveTab(TABS, 'config');
  const [token, setToken] = useState('');
  useEffect(() => { setToken(getToken() ?? ''); }, []);
  return (
    <>
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'config' ? <KycConfig token={token} canEdit={can('modules', 'manage')} /> : <KycAdmin token={token} canView={can('customers', 'view')} />}
    </>
  );
}

function KycConfig({ token, canEdit }: { token: string; canEdit: boolean }) {
  const notify = useNotify();
  const [cfg, setCfg] = useState<{ decisionMode?: string; defaultLevel?: string; reVerificationDays?: number; consentRequired?: boolean }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.modules.getConfig(CAP, token).then((c: unknown) => setCfg(((c as { moduleConfig?: Record<string, unknown> })?.moduleConfig ?? {}) as never)).catch(() => {}).finally(() => setLoading(false));
  }, [token]);
  const save = async () => {
    setSaving(true);
    try { await api.modules.updateConfig(CAP, cfg as Record<string, unknown>, token); notify('KYC configuration saved', 'success'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
    finally { setSaving(false); }
  };
  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      {!canEdit && <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">Read-only: editing requires <code className="font-mono text-xs">modules:manage</code>.</div>}
      <fieldset disabled={!canEdit} className="grid grid-cols-1 lg:grid-cols-2 gap-5 border-0 p-0 m-0 min-w-0">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Decision mode<Tooltip text="How a KYC process resolves. manual: officer decides. automated: rules auto-resolve (verified) at low risk with no PEP/sanctions; edge cases escalate. assisted: rules/AI recommend, a human confirms (HITL). Seeded automated (preserves current auto-verdict). Unset → manual (fail-safe)." /></h3>
          <select value={cfg.decisionMode ?? 'manual'} onChange={(e) => setCfg({ ...cfg, decisionMode: e.target.value })} className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {DECISION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900">Verification policy<Tooltip text="Built-in KYC engine policy: default CDD level, re-verification cadence and consent requirement." /></h3>
          <label className="text-xs text-gray-600 block">Re-verification (days)<input type="number" value={cfg.reVerificationDays ?? 365} onChange={(e) => setCfg({ ...cfg, reVerificationDays: Number(e.target.value) })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={cfg.consentRequired ?? true} onChange={(e) => setCfg({ ...cfg, consentRequired: e.target.checked })} /> Consent required</label>
        </div>
      </fieldset>
      {canEdit && <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium disabled:opacity-60"><Save size={14} />{saving ? 'Saving…' : 'Save configuration'}</button>}
    </div>
  );
}

function KycAdmin({ token, canView }: { token: string; canView: boolean }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const { debugMode } = useDebugMode();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('');
  const [segment, setSegment] = useState('');
  const [riskRating, setRiskRating] = useState('');
  // Default to customer-type parties (changeable). KYC administers cardholders/customers; staff and
  // service accounts are shown only when explicitly selected.
  const [partyType, setPartyType] = useState('customer');
  // Text search is EXPLICIT: the inputs only take effect on Enter or the Search button (committed into
  // `applied`), so a partial exact-match query doesn't clear the list on every keystroke.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [applied, setApplied] = useState({ name : '', email : '', phone : '', nationality: '' });
  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) return;
    setListLoading(true);
    try { const r = await api.customer.kycList({ status: status || undefined, segment: segment || undefined, riskRating: riskRating || undefined, partyType: partyType || undefined, name: applied.name || undefined, email: applied.email || undefined, phone: applied.phone || undefined, nationality: applied.nationality || undefined, page, limit }, token); setRows(r.results); setTotal(r.total); }
    catch { /* empty state */ }
    finally { setListLoading(false); }
  }, [token, status, segment, riskRating, partyType, applied, page, limit]);
  useEffect(() => { void load(); }, [load]);

  const doSearch = () => { setPage(1); setApplied({ name, email, phone, nationality }); };
  const clearAll = () => {
    setName(''); setEmail(''); setPhone(''); setNationality('');
    setApplied({ name : '', email : '', phone : '', nationality: '' });
    setStatus(''); setSegment(''); setRiskRating(''); setPartyType('customer'); setPage(1);
  };
  const onEnter = (e: { key: string }) => { if (e.key === 'Enter') doSearch(); };
  const hasActiveFilters = !!(applied.name || applied.email || applied.phone || applied.nationality || status || segment || riskRating || partyType !== 'customer');

  if (!canView) return <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">Your role cannot view KYC administration (requires <code className="font-mono text-xs">customers:view</code>).</div>;
  return (
    <div className="space-y-4">
      {/* Explicit search (Enter or Search button) over QE-searchable party attributes (name substring
          where available, email/phone/nationality exact) + live status/segment/risk/party-type filters. */}
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="Name…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
        <input placeholder="Email…" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
        <input placeholder="Phone…" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={onEnter} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
        <input placeholder="Nationality…" value={nationality} onChange={(e) => setNationality(e.target.value)} onKeyDown={onEnter} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" title="Exact match (QE:equality)" />
        <button onClick={doSearch} className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium transition-colors"><Search size={14} /> Search</button>
        {hasActiveFilters && <button onClick={clearAll} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-800"><X size={14} /> Clear</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Only a customer holds a CustomerAgreement (SD-53), so Employee is always empty here. */}
        <select value={partyType} onChange={(e) => { setPage(1); setPartyType(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" title="Party type. KYC administers customer agreements, which only a customer party holds."><option value="customer">Customer</option><option value="employee">Employee</option><option value="all">All</option></select>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"><option value="">All statuses</option>{['verified', 'rejected', 'expired'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={segment} onChange={(e) => { setPage(1); setSegment(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"><option value="">All segments</option>{['retail', 'premium', 'corporate', 'sme'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={riskRating} onChange={(e) => { setPage(1); setRiskRating(e.target.value); }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"><option value="">All risk</option>{['low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="py-2.5 px-4">Party</th><th className="py-2.5 px-4 hidden sm:table-cell">Segment</th><th className="py-2.5 px-4">KYC status</th><th className="py-2.5 px-4 hidden sm:table-cell">Risk</th><th className="py-2.5 px-4 hidden sm:table-cell">PEP</th><th className="py-2.5 px-4"></th>
          </tr></thead>
          <tbody>
            {listLoading && <tr><td colSpan={6}><LoadingIndicator label="Loading KYC records…" /></td></tr>}
            {!listLoading && rows.map((c) => (
              <tr key={String(c.partyInstanceReference)} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2.5 px-4"><div className="font-medium text-gray-900">{String(c.partyName ?? String(c.partyInstanceReference).slice(0, 8))}</div><div className="font-mono text-[11px] text-gray-400">{String(c.partyInstanceReference).slice(0, 13)}</div></td>
                <td className="py-2.5 px-4 hidden sm:table-cell text-gray-600">{String(c.customerSegment ?? '')}</td>
                <td className="py-2.5 px-4">{String(c.customerAgreementKycCheckStatus ?? '')}</td>
                <td className="py-2.5 px-4 hidden sm:table-cell">{String(c.customerAgreementKycCheckRiskRating ?? '')}</td>
                <td className="py-2.5 px-4 hidden sm:table-cell">{c.customerAgreementKycCheckPepStatus ? 'yes' : 'no'}</td>
                <td className="py-2.5 px-4 text-right"><Link href={`/system/admin/modules/kyc/${String(c.partyInstanceReference)}`} className="inline-flex items-center gap-1 text-[#016BF8] hover:underline">Review <ArrowRight size={14} /></Link></td>
              </tr>
            ))}
            {!listLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 px-4 text-center text-sm text-gray-400">
                {partyType === 'employee'
                  ? 'No employee holds a customer agreement. KYC administers cardholders, and in BIAN only a customer party holds a CustomerAgreement, so this surface is empty for employees by design.'
                  : 'No KYC records match.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {/* v32 E1/E3: the population is stated explicitly. It is NOT the same as the number of login
          users a manager sees: this counts parties with a COMPLETED KYC record (agreements,
          statuses verified / rejected / expired), while the user administration surface counts
          authentication users. Records still in `initiated` are excluded here, which is why
          this total can be lower than the number of customer agreements. */}
      {!listLoading && (
        <>
          <p className="text-xs text-gray-500">
            {total} {total === 1 ? 'user' : 'users'} with a completed KYC record
            {status ? ` (status: ${status})` : ' (verified, rejected or expired; records still initiated are excluded)'}.
            {debugMode && ' SD-53 customer agreements, not SD-16 authentication users: the two populations differ.'}
          </p>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / limit))} total={total} limit={limit} onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="KYC records" />
        </>
      )}
    </div>
  );
}
