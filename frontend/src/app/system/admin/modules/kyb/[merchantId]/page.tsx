'use client';
// v31: KYB administration detail (deep-linkable, §7.2). Structured entity-layer verdict + owner-layer
// risk (composed from each UBO's KYC), beneficial-owners panel, KYB-data correction (amendmentReason
// required; never edits the verdict/status — decision 2), and the correlated process timeline (§5bis.5).
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, Save, ShieldCheck, History, AlertTriangle, Pencil, X } from 'lucide-react';
import { SectionHeader } from '../../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../../components/Tooltip';
import { OwnersPanel } from '../../../../../../components/merchant/OwnersPanel';
import { api } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { useNotify } from '../../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../../lib/permissions';

interface KybDetail {
  merchant?: Record<string, unknown>;
  ownerLayerRisk?: { anyPep?: boolean; anySanctionsHit?: boolean; maxRiskRating?: string | null };
}

function Badge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }) {
  const cls = { green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-700 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200', gray: 'bg-gray-50 text-gray-600 border-gray-200' }[tone];
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
}

export default function KybDetailPage() {
  const params = useParams();
  const merchantId = String(params.merchantId);
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canManage = can('merchants', 'manage');
  const [token, setToken] = useState('');
  const [detail, setDetail] = useState<KybDetail | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<{ merchantLegalEntityReference?: string; merchantCategoryCode?: string; merchantAgreementKybCheckNotes?: string }>({});

  const editFromMerchant = (m: Record<string, unknown>) => ({
    merchantLegalEntityReference: String(m.merchantLegalEntityReference ?? ''),
    merchantCategoryCode: String(m.merchantCategoryCode ?? ''),
    merchantAgreementKybCheckNotes: String((m.merchantAgreementKybCheck as Record<string, unknown> | undefined)?.merchantAgreementKybCheckNotes ?? ''),
  });

  const load = useCallback(async (t: string) => {
    try {
      const d = await api.merchants.kybDetail(merchantId, t) as unknown as KybDetail;
      setDetail(d);
      setEdit(editFromMerchant(d.merchant ?? {}));
      const tl = await api.merchants.kybProcess(merchantId, t) as { results?: Record<string, unknown>[] };
      setTimeline(tl.results ?? []);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not load KYB detail', 'error'); }
  }, [merchantId, notify]);

  useEffect(() => { const t = getToken() ?? ''; setToken(t); if (t) void load(t); }, [load]);

  const cancelEdit = () => { setEdit(editFromMerchant(detail?.merchant ?? {})); setReason(''); setEditing(false); };
  const saveKyb = async () => {
    if (reason.trim().length < 3) { notify('An amendment reason is required.', 'error'); return; }
    try { await api.merchants.kybPatch(merchantId, { ...edit, amendmentReason: reason }, token); notify('KYB data corrected', 'success'); setReason(''); setEditing(false); void load(token); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
  };

  const m = (detail?.merchant ?? {}) as Record<string, unknown>;
  const kyb = (m.merchantAgreementKybCheck ?? {}) as Record<string, unknown>;
  const olr = detail?.ownerLayerRisk;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'KYB', href: '/system/admin/modules/kyb' }, { label: String(m.merchantName ?? merchantId) }]} />
      <SectionHeader icon={Building2} title={String(m.merchantName ?? 'Merchant')} description="KYB administration: verdict review, beneficial owners, data correction, process timeline." debugInfo={`merchant=${merchantId} · SD-89`} />

      {/* Entity verdict + owner-layer risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><ShieldCheck size={15} /> Entity-layer verdict (SD-89 BQ:Step)
            <Tooltip text="Structured KYB verdict produced by the screening chain (kyb_business + hrp + aml), not manual entry. businessRiskLevel/sanctions/adverse-media are result vocabularies; the BQ:Step status is derived from them by the shared mapper (§3.7)." /></h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500 text-xs">Status</span> <Badge label={String(kyb.merchantAgreementKybCheckStatus ?? 'n/a')} tone={kyb.merchantAgreementKybCheckStatus === 'verified' ? 'green' : kyb.merchantAgreementKybCheckStatus === 'rejected' ? 'red' : 'gray'} />
            <span className="text-gray-500 text-xs ml-2">Risk</span> <Badge label={String(kyb.merchantAgreementKybCheckBusinessRiskLevel ?? 'n/a')} tone={kyb.merchantAgreementKybCheckBusinessRiskLevel === 'low' ? 'green' : kyb.merchantAgreementKybCheckBusinessRiskLevel === 'high' ? 'red' : 'amber'} />
            <span className="text-gray-500 text-xs ml-2">Sanctions</span> <Badge label={String(kyb.merchantAgreementKybCheckSanctionsResult ?? 'n/a')} tone={kyb.merchantAgreementKybCheckSanctionsResult === 'hit' ? 'red' : 'green'} />
            <span className="text-gray-500 text-xs ml-2">Adverse media</span> <Badge label={String(kyb.merchantAgreementKybCheckAdverseMediaResult ?? 'n/a')} tone={kyb.merchantAgreementKybCheckAdverseMediaResult === 'hit' ? 'red' : 'green'} />
          </div>
          <p className="text-[11px] text-gray-400 font-mono">provider: {String(kyb.merchantAgreementKybCheckScreeningProviderRef ?? 'n/a')}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">Owner-layer risk (composed)
            <Tooltip text="Aggregated from each beneficial owner's SD-53 KYC verdict by reference (no PII duplication). A controlling person failing PEP/sanctions raises the merchant's risk." /></h3>
          {olr ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge label={`PEP: ${olr.anyPep ? 'hit' : 'clear'}`} tone={olr.anyPep ? 'red' : 'green'} />
              <Badge label={`Sanctions: ${olr.anySanctionsHit ? 'hit' : 'clear'}`} tone={olr.anySanctionsHit ? 'red' : 'green'} />
              <Badge label={`Max owner risk: ${olr.maxRiskRating ?? 'n/a'}`} tone={olr.maxRiskRating === 'high' ? 'red' : olr.maxRiskRating === 'medium' ? 'amber' : 'green'} />
            </div>
          ) : <p className="text-sm text-gray-400">No owner risk composed.</p>}
          {(olr?.anyPep || olr?.anySanctionsHit) && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> A controlling person raises the merchant risk (escalate; never auto-approve).</p>}
        </div>
      </div>

      {/* Beneficial owners */}
      {token && <OwnersPanel merchantId={merchantId} token={token} canManage={canManage} />}

      {/* KYB data */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">KYB data<Tooltip text="KYB data fields (legal entity, MCC, notes). This is data administration, NOT a decision: the verdict/status is not editable here (approve/reject stays with merchant_officer). Click Edit to correct a field; an amendment reason is required (audit, PCI Req 10)." /></h3>
          {canManage && !editing && <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium transition-colors"><Pencil size={14} /> Edit</button>}
        </div>

        {!editing ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-gray-500">Legal entity reference</dt><dd className="text-gray-900">{edit.merchantLegalEntityReference || <span className="text-gray-400">n/a</span>}</dd></div>
            <div><dt className="text-xs text-gray-500">MCC</dt><dd className="text-gray-900">{edit.merchantCategoryCode || <span className="text-gray-400">n/a</span>}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-gray-500">KYB notes</dt><dd className="text-gray-900">{edit.merchantAgreementKybCheckNotes || <span className="text-gray-400">n/a</span>}</dd></div>
          </dl>
        ) : (
          <>
            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-0 p-0 m-0 min-w-0">
              <label className="text-xs text-gray-600 block">Legal entity reference<input value={edit.merchantLegalEntityReference ?? ''} onChange={(e) => setEdit({ ...edit, merchantLegalEntityReference: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block">MCC<input value={edit.merchantCategoryCode ?? ''} onChange={(e) => setEdit({ ...edit, merchantCategoryCode: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block sm:col-span-2">KYB notes<input value={edit.merchantAgreementKybCheckNotes ?? ''} onChange={(e) => setEdit({ ...edit, merchantAgreementKybCheckNotes: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block sm:col-span-2">Amendment reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. corrected legal entity reference per registry update" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
            </fieldset>
            <div className="flex items-center gap-2 pt-4 mt-1 border-t border-gray-100">
              <button onClick={saveKyb} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium transition-colors"><Save size={14} /> Save changes</button>
              <button onClick={cancelEdit} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg text-gray-500 hover:text-gray-800"><X size={14} /> Cancel</button>
            </div>
          </>
        )}
      </div>

      {/* Process timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><History size={15} /> Process timeline
          <Tooltip text="Every event of the KYB journey by correlationId: bus milestones (*.requested/*.completed) and provider wire calls (sanitized request/response, PCI Req 10.7). Reconstructs what ran, which providers were called, and what each responded." /></h3>
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

      <Link href="/system/admin/modules/kyb" className="text-sm text-gray-500 hover:text-gray-800">← Back to KYB administration</Link>
    </div>
  );
}
