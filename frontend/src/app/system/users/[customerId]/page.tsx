'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { useResource } from '../../../../lib/useResource';
import { readEscalationToken } from '../../../../lib/escalation';
import { useDebugMode } from '../../../../lib/debugMode';
import { UserCheck, ShieldCheck, Lock } from 'lucide-react';

const SEGMENT_LABELS: Record<string, string> = { retail: 'Retail', premium: 'Premium', corporate: 'Corporate', sme: 'SME' };

// Customer detail (KYC) by instance reference, role-gated by the backend:
//  L1 → summary only · L2 → sensitive PII with a valid escalation token · Auditor → full.
export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const router = useRouter();
  const { debugMode } = useDebugMode();

  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [authReady, setAuthReady] = useState(false);
  const [navCtx, setNavCtx] = useState<{ from: string; txnId?: string; caseId?: string; caseRef?: string } | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    if (u?.role === 'customer') { router.replace('/system/payment/history'); return; }
    setToken(t);
    setRole(u?.role ?? 'level1_analyst');
    setAuthReady(true);
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const from = sp.get('from');
      if (from === 'transaction' && sp.get('txnId')) setNavCtx({ from, txnId: sp.get('txnId')! });
      else if (from === 'investigation' && sp.get('caseId')) setNavCtx({ from, caseId: sp.get('caseId')!, caseRef: sp.get('caseRef') ?? undefined });
    }
  }, [customerId, router]);

  // When arriving from a case, reuse that case's escalation token so an L2 who approved the
  // escalation keeps sensitive access here (the backend re-validates it; expired → no PII).
  const escToken = navCtx?.from === 'investigation' && navCtx.caseId ? readEscalationToken(navCtx.caseId) : undefined;
  // Cache key scoped by role AND escalation so a summary view is never reused as a full view.
  const key = authReady ? `customer:${customerId}:${role}:${escToken ? 'e' : 'n'}` : null;
  const { data: customer, loading: resLoading, error } = useResource<Record<string, unknown>>(
    key, () => api.customer.getById(customerId, token, escToken),
  );
  const loading = !authReady || resLoading;
  const notFound = !!error;

  const isAuditor = role === 'security_auditor';
  const roleLabel = role === 'level1_analyst' ? 'L1 Access' : role === 'level2_investigator' ? 'L2 Access' : isAuditor ? 'Auditor Access' : role;

  if (loading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-400 text-sm">Loading customer…</div>;
  if (notFound || !customer) return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-500 space-y-3">
      <p>Customer not found.</p>
      <Link href="/system/users" className="text-blue-600 hover:underline text-sm">← Back to users</Link>
    </div>
  );

  const c = customer;
  const name = String(c.customerName ?? 'Customer');
  const kyc = c.customerAgreementKycCheck as { customerAgreementKycCheckStatus?: string; customerAgreementKycCheckReference?: string; customerAgreementKycCheckCompletedDate?: string; customerAgreementKycCheckNotes?: string } | null;
  const sensitive = c.sensitive as { customerAgreementResidentialAddress?: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }; governmentIdentificationReference?: string; customerAgreementRiskNotes?: string } | undefined;

  const crumbs: Crumb[] =
    navCtx?.from === 'investigation' && navCtx.caseId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Cases', href: '/system/investigation' },
          { label: navCtx.caseRef || 'Case', href: `/system/investigation/${navCtx.caseId}` },
          { label: name },
        ]
      : navCtx?.from === 'transaction' && navCtx.txnId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Transactions', href: '/system/transactions' },
          { label: 'Transaction', href: `/system/transactions/${navCtx.txnId}` },
          { label: name },
        ]
      : [
          { label: 'Home', href: '/system' },
          { label: 'Users', href: '/system/users' },
          { label: name },
        ];

  const Field = ({ label, value }: { label: string; value?: unknown }) => (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right truncate">{value != null && value !== '' ? String(value) : '-'}</span>
    </>
  );

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[#001E2B]/10 flex items-center justify-center"><UserCheck size={18} className="text-[#001E2B]" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{name}</h1>
          <p className="text-xs text-gray-400 font-mono">{String(c.customerAgreementInstanceReference ?? customerId)}</p>
        </div>
        <span className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{roleLabel}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile (QE:equality fields decrypt for staff; no QE:none here) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">Profile</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Email" value={c.customerEmailAddress} />
            <Field label="Phone" value={c.customerMobilePhoneNumber} />
            <Field label="Account reference" value={c.customerAgreementReference} />
            <Field label="Segment" value={SEGMENT_LABELS[String(c.customerSegment)] ?? c.customerSegment} />
            <Field label="Status" value={c.customerAgreementStatus} />
            <Field label="Enrolled" value={c.customerAgreementEnrollmentDate ? new Date(String(c.customerAgreementEnrollmentDate)).toLocaleDateString() : undefined} />
            <Field label="Language" value={c.customerAgreementPreferredLanguage} />
          </div>
          {c.contactPiiRestricted === true && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Contact PII (email, phone) is restricted at the L1 access level{debugMode ? ' (PCI DSS Req 7, need-to-know)' : ''}. Available to L2 investigators and the security auditor.
            </p>
          )}
        </div>

        {/* KYC check (BIAN SD-53 BQ:Step) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-teal-600" /> KYC check{debugMode ? ' (SD-53)' : ''}</h2>
          {kyc ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Status" value={kyc.customerAgreementKycCheckStatus} />
              <Field label="Reference" value={kyc.customerAgreementKycCheckReference} />
              <Field label="Completed" value={kyc.customerAgreementKycCheckCompletedDate ? new Date(String(kyc.customerAgreementKycCheckCompletedDate)).toLocaleDateString() : undefined} />
              {kyc.customerAgreementKycCheckNotes && (<><span className="text-gray-500">Notes</span><span className="text-right">{kyc.customerAgreementKycCheckNotes}</span></>)}
            </div>
          ) : <p className="text-sm text-gray-400">No KYC record.</p>}
        </div>
      </div>

      {/* Sensitive PII; auditor always; L2 only with a valid escalation token */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={14} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800 text-sm">Sensitive PII{debugMode ? ' (QE:none)' : ''}</h2>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sensitive ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
            {sensitive ? 'Unlocked' : 'Restricted'}
          </span>
        </div>
        {sensitive ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Address" value={sensitive.customerAgreementResidentialAddress ? [sensitive.customerAgreementResidentialAddress.streetAddress, sensitive.customerAgreementResidentialAddress.city, sensitive.customerAgreementResidentialAddress.postalCode, sensitive.customerAgreementResidentialAddress.countryCode].filter(Boolean).join(', ') : undefined} />
            <Field label="Government ID" value={sensitive.governmentIdentificationReference} />
            {sensitive.customerAgreementRiskNotes && (<><span className="text-gray-500">Risk notes</span><span className="text-right">{sensitive.customerAgreementRiskNotes}</span></>)}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">
            {debugMode && 'Address, government ID and risk notes are QE:none (encrypted, not searchable). '}
            {isAuditor ? 'Address, government ID and risk notes are unavailable.' : 'Address, government ID and risk notes require a valid L2 escalation acceptance; the security auditor has full access.'}
          </p>
        )}
      </div>
    </div>
  );
}
