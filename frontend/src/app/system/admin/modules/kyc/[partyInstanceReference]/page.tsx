'use client';
// v31: KYC administration detail (deep-linkable, §7.2). KYC identity + v27 verdict, data correction
// (amendmentReason required; never edits the verdict/status — decision 2), re-screen, and the
// correlated process timeline (§5bis.5). Sensitive fields are masked unless the caller holds the
// escalation token (viewSensitive) — the backend is the boundary.
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { UserCheck, Save, RefreshCw, History, ShieldCheck, Lock, Pencil, X, IdCard, Mail, FileText } from 'lucide-react';
import { SectionHeader } from '../../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../../components/Breadcrumb';
import { Tooltip } from '../../../../../../components/Tooltip';
import { EncryptionBadge } from '../../../../../../components/EncryptionBadge';
import { SensitiveReveal } from '../../../../../../components/SensitiveReveal';
import { IdentityDocumentBlock } from '../../../../../../components/record/IdentityDocumentBlock';
import { RecordField } from '../../../../../../components/record/RecordField';
import { humanize, fmtAddress } from '../../../../../../components/record/format';
import { api } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { useNotify } from '../../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../../lib/permissions';
import { useDebugMode } from '../../../../../../lib/debugMode';

function Badge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }) {
  const cls = { green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-700 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200', gray: 'bg-gray-50 text-gray-600 border-gray-200' }[tone];
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
}



export default function KycDetailPage() {
  const params = useParams();
  const partyRef = String(params.partyInstanceReference);
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const { debugMode } = useDebugMode();
  const canManage = can('customers', 'manage');
  const [token, setToken] = useState('');
  const [rec, setRec] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
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

  const resetEdit = (d: Record<string, unknown> | null) => setEdit({
    customerAgreementOccupation: String(d?.customerAgreementOccupation ?? ''),
    customerAgreementSourceOfFunds: String(d?.customerAgreementSourceOfFunds ?? ''),
    customerAgreementPurposeOfRelationship: String(d?.customerAgreementPurposeOfRelationship ?? ''),
  });
  const cancelEdit = () => { resetEdit(rec); setReason(''); setEditing(false); };
  const save = async () => {
    if (reason.trim().length < 3) { notify('An amendment reason is required.', 'error'); return; }
    try { await api.customer.kycPatch(partyRef, { ...edit, amendmentReason: reason }, token); notify('KYC data corrected', 'success'); setReason(''); setEditing(false); void load(token); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save', 'error'); }
  };
  const rescreen = async () => {
    try { await api.customer.kycRescreen(partyRef, token); notify('Re-screen requested', 'success'); setTimeout(() => void load(token), 1200); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not re-screen', 'error'); }
  };

  // Audited reveal of the QE:none fields. Fetched ONCE per view (cached) so the eye toggles don't spam the
  // endpoint / audit log; the plaintext lives only in this component's memory while shown.
  const revealCache = useRef<Record<string, unknown> | null>(null);
  const fetchReveal = useCallback(async () => {
    if (!revealCache.current) revealCache.current = await api.customer.kycReveal(partyRef, token);
    return revealCache.current;
  }, [partyRef, token]);

  const r = rec ?? {};
  const kyc = (r.kycCheck ?? r.customerAgreementKycCheck ?? {}) as Record<string, unknown>;
  const status = String(kyc.customerAgreementKycCheckStatus ?? r.customerAgreementKycCheckStatus ?? 'n/a');
  const risk = String(kyc.customerAgreementKycCheckRiskRating ?? r.customerAgreementKycCheckRiskRating ?? 'n/a');
  const sanctions = String(kyc.customerAgreementKycCheckSanctionsResult ?? r.customerAgreementKycCheckSanctionsResult ?? 'n/a');
  const pep = kyc.customerAgreementKycCheckPepStatus ?? r.customerAgreementKycCheckPepStatus;
  const sensitiveMasked = Boolean(r.sensitiveMasked);
  const govId = (r.customerAgreementGovernmentID ?? {}) as Record<string, unknown>;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'KYC', href: '/system/admin/modules/kyc' }, { label: String(r.customerName ?? r.partyName ?? partyRef).slice(0, 24) }]} />
      <SectionHeader icon={UserCheck} title={String(r.customerName ?? r.partyName ?? 'Customer')} description="KYC administration: verdict review, data correction, re-screen, process timeline." debugInfo={`party=${partyRef} · SD-53`} />

      {/* Full person profile, distributed across four focused, semantically distinct cards (two columns
          on large screens). Each field carries an info tooltip (what it means + its encryption tier).
          QE-searchable fields are decrypted at rest for the KYC admin (need-to-know). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Personal details (SD-13 demographics) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><UserCheck size={15} /> Personal details
            <Tooltip text="SD-13 Party demographics. QE-searchable fields are encrypted at rest in Atlas (Queryable Encryption) and decrypted in-process for a role with need-to-know." /></h3>
          <dl className="text-sm">
            <RecordField label="Full name" value={String(r.customerName ?? '')} info="Legal name of the party (SD-13). Encrypted at rest with QE substring search so it can be found without decrypting server-side." />
            <RecordField label="Date of birth" value={r.partyDateOfBirth ? String(r.partyDateOfBirth).slice(0, 10) : ''} info="Party date of birth (SD-13). Encrypted at rest with QE range so it is searchable by range without exposing the value." />
            <RecordField label="Sex" value={humanize(r.partySex)} info="Party sex (SD-13). QE:equality encrypted at rest." />
            <RecordField label="Nationality" value={humanize(r.partyNationality)} info="Declared nationality. QE:equality encrypted (searchable by exact match)." />
            <RecordField label="Place of birth" value={humanize(r.partyPlaceOfBirth)} info="Declared place of birth. QE:equality encrypted at rest." />
          </dl>
        </div>

        {/* Identity document (SD-53): rendered by the shared block (v32 B4), so this page and every
            other customer surface show the same fields from the same source of truth. */}
        <IdentityDocumentBlock governmentId={govId} taxIdNumber={r.customerAgreementTaxIDNumber} />

        {/* Contact & preferences (SD-13) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><Mail size={15} /> Contact &amp; preferences
            <Tooltip text="How the customer is reached (SD-13). Email and phone are QE:equality (encrypted at rest, exact-match searchable), decrypted for the KYC admin's need-to-know. Residential/postal address is under Protected details (audited reveal)." /></h3>
          <dl className="text-sm">
            <RecordField label="Email" value={String(r.customerEmailAddress ?? '')} info="Contact email (SD-13). QE:equality encrypted at rest (exact-match searchable)." />
            <RecordField label="Phone" value={String(r.customerMobilePhoneNumber ?? '')} info="Contact mobile phone (SD-13). QE:equality encrypted at rest (exact-match searchable)." />
            <RecordField label="Preferred language" value={humanize(r.customerAgreementPreferredLanguage)} info="Preferred communication language (SD-53). Plaintext business metadata." />
          </dl>
        </div>

        {/* Customer agreement (SD-53) — account classification & lifecycle metadata */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><FileText size={15} /> Customer agreement
            <Tooltip text="SD-53 customer-agreement classification & lifecycle: party type, commercial segment, declared occupation, lifecycle status, enrolment date and the internal agreement reference." /></h3>
          <dl className="text-sm">
            <RecordField label="Party type" value={humanize(r.partyType)} info="Classification of the party: customer, employee or service account. Not PII; stored in plaintext." />
            <RecordField label="Segment" value={humanize(r.customerSegment)} info="Commercial segment (retail / premium / corporate / SME). Business metadata, plaintext." />
            <RecordField label="Occupation" value={humanize(r.customerAgreementOccupation)} info="Declared occupation (KYC/AML risk signal). QE:equality encrypted at rest." />
            <RecordField label="Agreement status" value={humanize(r.customerAgreementStatus)} info="BIAN SD-53 agreement lifecycle status (initiated / active / suspended / closed …). Plaintext." />
            <RecordField label="Enrolled" value={r.customerAgreementEnrollmentDate ? String(r.customerAgreementEnrollmentDate).slice(0, 10) : ''} info="Date the customer agreement was enrolled. Plaintext business metadata." />
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-1.5 text-gray-500 shrink-0">Agreement reference<Tooltip text="Internal reference for the customer agreement (SD-53), used for lookups. QE:equality encrypted at rest." /></span>
              <span className="text-gray-800 text-right font-mono text-xs break-all">{String(r.customerAgreementReference ?? partyRef)}</span>
            </div>
          </dl>
        </div>
      </div>

      {/* Protected details (QE:none, L2-only). Masked by default; audited on-demand reveal (eye). */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><Lock size={15} /> Protected details
            <Tooltip text="QE:none fields (encrypted at rest, NOT searchable): residential/postal address, source of funds, purpose of relationship, risk notes. Hidden by default; the eye performs an on-demand, ephemeral, audited reveal (PCI Req 3.2/3.3, GDPR need-to-know, Req 10). The value is never persisted or logged; only the fact of the reveal is audited (field names only)." /></h3>
          {debugMode && <EncryptionBadge label="QE: encrypted, not searchable" type="qe-none" />}
        </div>
        <div className="divide-y divide-gray-50">
          <SensitiveReveal label="Residential address" masked="•••• (masked)" fetchValue={async () => fmtAddress((await fetchReveal()).customerAgreementResidentialAddress) || 'n/a'} />
          <SensitiveReveal label="Source of funds" masked="•••• (masked)" fetchValue={async () => humanize((await fetchReveal()).customerAgreementSourceOfFunds) || 'n/a'} />
          <SensitiveReveal label="Purpose of relationship" masked="•••• (masked)" fetchValue={async () => humanize((await fetchReveal()).customerAgreementPurposeOfRelationship) || 'n/a'} />
          <SensitiveReveal label="Risk notes" masked="•••• (masked)" fetchValue={async () => String((await fetchReveal()).customerAgreementRiskNotes ?? 'n/a')} />
          <SensitiveReveal label="Postal address" masked="•••• (masked)" fetchValue={async () => fmtAddress((await fetchReveal()).partyPostalAddress) || 'n/a'} />
        </div>
        {!canManage && <p className="text-xs text-gray-400 pt-2">Reveal requires <code className="font-mono">customers:manage</code>.</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><ShieldCheck size={15} /> KYC verdict
          <Tooltip text="Structured KYC verdict from the screening chain (kyc_identity + hrp). The BQ:Step status is derived from the verdict by the shared mapper: a sanctions hit → rejected; automated + low risk + no PEP → verified; manual/assisted → stays initiated until an officer resolves." /></h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500 text-xs">Status</span><Badge label={status} tone={status === 'verified' ? 'green' : status === 'rejected' ? 'red' : 'gray'} />
          <span className="text-gray-500 text-xs ml-2">Risk</span><Badge label={risk} tone={risk === 'low' ? 'green' : risk === 'high' ? 'red' : 'amber'} />
          <span className="text-gray-500 text-xs ml-2">Sanctions</span><Badge label={sanctions} tone={sanctions === 'hit' ? 'red' : 'green'} />
          <span className="text-gray-500 text-xs ml-2">PEP</span><Badge label={pep ? 'yes' : 'no'} tone={pep ? 'red' : 'green'} />
        </div>
        {canManage && <button onClick={rescreen} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"><RefreshCw size={13} /> Re-screen via provider</button>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">KYC data<Tooltip text="KYC data fields (occupation, source of funds, purpose). This is data administration, NOT a decision: the verdict/status is not editable here. Click Edit to correct a field; an amendment reason is required (audit, PCI Req 10). Sensitive identity fields require the escalation token to view decrypted." /></h3>
          {canManage && !editing && <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium transition-colors"><Pencil size={14} /> Edit</button>}
        </div>
        {sensitiveMasked && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>Source of funds, purpose, risk notes and address are QE:none (L2-only) and are <strong>masked</strong> for your access tier. They appear blank because they require an escalation token (viewSensitive), not because they are empty. The identity document (number QE:suffix, type and country QE:equality, expiry QE:range), tax ID (QE:prefix) and occupation (QE:equality) are lookup tier and ARE shown.{editing && <> Editing a masked field will overwrite it.</>}</span>
          </div>
        )}

        {!editing ? (
          // Read-only display panel
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-gray-500">Occupation</dt><dd className="text-gray-900">{edit.customerAgreementOccupation || <span className="text-gray-400">n/a</span>}</dd></div>
            <div><dt className="text-xs text-gray-500">Source of funds</dt><dd className="text-gray-900">{edit.customerAgreementSourceOfFunds || <span className="text-gray-400">{sensitiveMasked ? 'masked (escalation required)' : 'n/a'}</span>}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-gray-500">Purpose of relationship</dt><dd className="text-gray-900">{edit.customerAgreementPurposeOfRelationship || <span className="text-gray-400">{sensitiveMasked ? 'masked (escalation required)' : 'n/a'}</span>}</dd></div>
          </dl>
        ) : (
          // Edit mode
          <>
            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-0 p-0 m-0 min-w-0">
              <label className="text-xs text-gray-600 block">Occupation<input value={edit.customerAgreementOccupation ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementOccupation: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block">Source of funds{sensitiveMasked && <span className="ml-1 text-amber-600">(masked)</span>}<input placeholder={sensitiveMasked ? 'escalation required to view' : ''} value={edit.customerAgreementSourceOfFunds ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementSourceOfFunds: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block sm:col-span-2">Purpose of relationship{sensitiveMasked && <span className="ml-1 text-amber-600">(masked)</span>}<input placeholder={sensitiveMasked ? 'escalation required to view' : ''} value={edit.customerAgreementPurposeOfRelationship ?? ''} onChange={(e) => setEdit({ ...edit, customerAgreementPurposeOfRelationship: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-gray-600 block sm:col-span-2">Amendment reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. corrected occupation per updated KYC document" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
            </fieldset>
            <div className="flex items-center gap-2 pt-4 mt-1 border-t border-gray-100">
              <button onClick={save} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium transition-colors"><Save size={14} /> Save changes</button>
              <button onClick={cancelEdit} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg text-gray-500 hover:text-gray-800"><X size={14} /> Cancel</button>
            </div>
          </>
        )}
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
