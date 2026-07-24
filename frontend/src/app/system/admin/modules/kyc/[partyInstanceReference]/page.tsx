'use client';
// v31: KYC administration detail (deep-linkable, §7.2). KYC identity + v27 verdict, data correction
// (amendmentReason required; never edits the verdict/status — decision 2), re-screen, and the
// correlated process timeline (§5bis.5). Sensitive fields are masked unless the caller holds the
// escalation token (viewSensitive) — the backend is the boundary.
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { UserCheck, Save, RefreshCw, History, ShieldCheck } from 'lucide-react';
import { SectionHeader } from '../../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../../components/Tooltip';
import { api } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { useNotify } from '../../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../../lib/permissions';

function Badge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }) {
  const cls = { green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-700 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200', gray: 'bg-gray-50 text-gray-600 border-gray-200' }[tone];
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
}

export default function KycDetailPage() {
  const params = useParams();
  const partyRef = String(params.partyInstanceReference);
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canManage = can('customers', 'manage');
  const [token, setToken] = useState('');
  const [rec, setRec] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState<{ customerAgreementOccupation?: string; customerAgreementSourceOfFunds?: string; customerAgreementPurposeOfRelationship?: string }>({});

  const load = useCallback(async (t: string) => {
    try {
      const d = await api.customer.kycDetail(partyRef, t) as Record<string, unknown>;
      setRec(d);
      setEdit({ customerAgreementOccupation: String(d.customerAgreementOccupation ?? ''), customerAgreementSourceOfFunds: String(d.customerAgreementSourceOfFunds ?? ''), customerAgreementPurposeOfRelationship: String(d.customerAgreementPurposeOfRelationship ?? '') });
      const tl = await api.customer.kycProcess(partyRef, t) as { results?: Record<string, unknown>[] };
      setTimeline(tl.results ?? []);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not load KYC detail', 'error'); }
  }, [partyRef, notify]);

  useEffect(() => { const t = getToken() ?? ''; setToken(t); if (t) void load(t); }, [load]);

  const save = async () => {
    if (reason.trim().length < 3) { notify('An amendment reason is required.', 'error'); return; }
    try { await api.customer.kycPatch(partyRef, { ...edit, amendmentReason: reason }, token); notify('KYC data corrected', 'success'); setReason(''); void load(token); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
  };
  const rescreen = async () => {
    try { await api.customer.kycRescreen(partyRef, token); notify('Re-screen requested', 'success'); setTimeout(() => void load(token), 1200); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not re-screen', 'error'); }
  };

  const r = rec ?? {};
  const kyc = (r.kycCheck ?? r.customerAgreementKycCheck ?? {}) as Record<string, unknown>;
  const status = String(kyc.customerAgreementKycCheckStatus ?? r.customerAgreementKycCheckStatus ?? 'n/a');
  const risk = String(kyc.customerAgreementKycCheckRiskRating ?? r.customerAgreementKycCheckRiskRating ?? 'n/a');
  const sanctions = String(kyc.customerAgreementKycCheckSanctionsResult ?? r.customerAgreementKycCheckSanctionsResult ?? 'n/a');
  const pep = kyc.customerAgreementKycCheckPepStatus ?? r.customerAgreementKycCheckPepStatus;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'KYC', href: '/system/admin/modules/kyc' }, { label: String(r.customerName ?? r.partyName ?? partyRef).slice(0, 24) }]} />
      <SectionHeader icon={UserCheck} title={String(r.customerName ?? r.partyName ?? 'Customer')} description="KYC administration: verdict review, data correction, re-screen, process timeline." debugInfo={`party=${partyRef} · SD-53`} />

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><ShieldCheck size={15} /> KYC verdict (v27, BQ:Step)
          <Tooltip text="Structured KYC verdict from the screening chain (kyc_identity + hrp). The BQ:Step status is derived from the verdict by the shared mapper (§3.7): a sanctions hit → rejected; automated + low risk + no PEP → verified; manual/assisted → stays initiated until an officer resolves." /></h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500 text-xs">Status</span><Badge label={status} tone={status === 'verified' ? 'green' : status === 'rejected' ? 'red' : 'gray'} />
          <span className="text-gray-500 text-xs ml-2">Risk</span><Badge label={risk} tone={risk === 'low' ? 'green' : risk === 'high' ? 'red' : 'amber'} />
          <span className="text-gray-500 text-xs ml-2">Sanctions</span><Badge label={sanctions} tone={sanctions === 'hit' ? 'red' : 'green'} />
          <span className="text-gray-500 text-xs ml-2">PEP</span><Badge label={pep ? 'yes' : 'no'} tone={pep ? 'red' : 'green'} />
        </div>
        {canManage && <button onClick={rescreen} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"><RefreshCw size={13} /> Re-screen via provider</button>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-sm text-gray-900">KYC data correction<Tooltip text="Corrects KYC data fields (occupation, source of funds, purpose). This is data administration, NOT a decision: the verdict/status is not editable here. An amendment reason is required (audit, PCI Req 10). Sensitive identity fields require the escalation token to view decrypted." /></h3>
        <fieldset disabled={!canManage} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-0 p-0 m-0 min-w-0">
          <label className="text-xs text-gray-600 block">Occupation<input value={edit.customerAgreementOccupation ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementOccupation: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-gray-600 block">Source of funds<input value={edit.customerAgreementSourceOfFunds ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementSourceOfFunds: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-gray-600 block sm:col-span-2">Purpose of relationship<input value={edit.customerAgreementPurposeOfRelationship ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementPurposeOfRelationship: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-gray-600 block sm:col-span-2">Amendment reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
        </fieldset>
        {canManage && <button onClick={save} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium"><Save size={14} /> Save correction</button>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><History size={15} /> Process timeline
          <Tooltip text="Every event of the KYC journey by correlationId (= partyInstanceReference): bus milestones and provider wire calls (sanitized, PCI Req 10.7)." /></h3>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-left text-gray-500 border-b border-gray-100"><th className="py-1.5 pr-3">When</th><th className="py-1.5 pr-3">Source</th><th className="py-1.5 pr-3">Action</th><th className="py-1.5 pr-3">Outcome</th></tr></thead>
            <tbody>
              {timeline.map((e, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{String((e.eventDateTime ?? e.time ?? '') as string).slice(0, 19).replace('T', ' ')}</td>
                  <td className="py-1.5 pr-3">{String(e.source ?? e.kind ?? '')}</td>
                  <td className="py-1.5 pr-3 font-mono">{String(e.processAction ?? e.type ?? e.eventType ?? '')}</td>
                  <td className="py-1.5 pr-3">{String(e.processOutcome ?? e.outcome ?? '')}</td>
                </tr>
              ))}
              {timeline.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No process events yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Link href="/system/admin/modules/kyc" className="text-sm text-gray-500 hover:text-gray-800">← Back to KYC administration</Link>
    </div>
  );
}
