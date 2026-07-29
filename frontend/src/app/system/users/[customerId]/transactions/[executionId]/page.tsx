'use client';
// v27 staff drill-down: display-safe SD-65 payment execution (transfer) detail for one customer.
// Staff-only (level2_investigator / security_auditor); the server re-enforces the role and party
// ownership. Never renders CHD or the raw destination IBAN, only what the API returns.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Landmark, Receipt, ShieldAlert, ChevronRight } from 'lucide-react';
import { api, type ExecutionDetail } from '../../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../../../components/Breadcrumb';
import { LoadingIndicator } from '../../../../../../components/LoadingIndicator';
import { useConfirm, useNotify } from '../../../../../../components/ui/ConfirmProvider';

function money(amount?: number | null, currency?: string | null): string {
  if (amount == null) return '-';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency ?? ''}`.trim(); }
}

function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (['completed', 'settled', 'authorized', 'approved'].includes(s)) return 'bg-green-100 text-green-700';
  if (['pending', 'processing', 'initiated'].includes(s)) return 'bg-amber-100 text-amber-700';
  if (['failed', 'declined', 'blocked', 'rejected', 'reversed'].includes(s)) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-500';
}

const STEP_PILL: Record<string, string> = {
  found: 'bg-green-100 text-green-700',
  fallback: 'bg-amber-100 text-amber-700',
  not_found: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffExecutionDetailPage() {
  const { customerId, executionId } = useParams<{ customerId: string; executionId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();

  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [token, setToken] = useState('');
  const [role, setRole] = useState<string | null>(null);
  // Existing fraud case for this transfer (if any). P2P/transfer cases carry the executionId as their
  // cardTransactionInstanceReference, so the standard transactionId filter finds them.
  const [linkedCase, setLinkedCase] = useState<{ id: string; ref: string } | null>(null);
  const [openBusy, setOpenBusy] = useState(false);

  // Auditor is read-only; only the L2 investigator may open an investigation (SoD, PCI DSS Req 7).
  const canOpen = role === 'level2_investigator';

  useEffect(() => {
    const t = getToken() ?? '';
    const r = t ? decodeToken(t)?.role ?? null : null;
    // Staff-only page; anyone else is bounced (the server also enforces the role).
    if (r !== 'level2_investigator' && r !== 'security_auditor') { router.replace('/system'); return; }
    setToken(t);
    setRole(r);
    let alive = true;
    setLoading(true);
    api.customer.transactionDetail(customerId, executionId, t)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    // Look up any existing case for this transfer so we can offer "View case" instead of "Open".
    api.fraud.list({ transactionId: executionId, limit: 1 }, t)
      .then((res) => {
        const c = res.results?.[0];
        if (alive && c) setLinkedCase({ id: c.fraudDiagnosisInstanceReference, ref: c.fraudDiagnosisCaseReference });
      })
      .catch(() => { /* no case, or list unavailable */ });
    return () => { alive = false; };
  }, [customerId, executionId, router]);

  async function handleOpenInvestigation() {
    if (!canOpen || openBusy) return;
    const ok = await confirm({
      title: 'Open investigation case?',
      message: 'This opens a fraud diagnosis case (SD-83) for this transfer and records the action in the audit trail.',
      confirmLabel: 'Open case',
    });
    if (!ok) return;
    setOpenBusy(true);
    try {
      const res = await api.fraud.open({ executionId }, token);
      notify('Investigation case opened.', 'success');
      router.push(`/system/investigation/${res.fraudDiagnosisInstanceReference}`);
    } catch (err) {
      notify(`Could not open case: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setOpenBusy(false);
    }
  }

  const crumbs: Crumb[] = [
    { label: 'Home', href: '/system' },
    { label: 'Users', href: '/system/users' },
    { label: 'Customer', href: `/system/users/${customerId}` },
    { label: 'Transfer' },
  ];

  const Field = ({ label, value }: { label: string; value?: unknown }) => (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right break-all">{value != null && value !== '' ? String(value) : '-'}</span>
    </>
  );

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {loading ? (
        <LoadingIndicator label="Loading transfer…" />
      ) : notFound || !detail ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          This transfer could not be found for this customer.
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-full bg-[#001E2B]/10 flex items-center justify-center">
              <Receipt size={18} className="text-[#001E2B]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                {detail.direction === 'received' ? <ArrowDownLeft size={18} className="text-green-700" /> : <ArrowUpRight size={18} className="text-gray-600" />}
                {money(detail.grossAmount, detail.currency)}
              </h1>
              <p className="text-xs text-gray-400 font-mono">{detail.paymentExecutionInstanceReference}</p>
            </div>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${statusPill(detail.paymentExecutionStatus)}`}>{detail.paymentExecutionStatus}</span>
          </div>

          {/* Investigation action: view the existing case, or (L2 only) open a new one */}
          <div className="flex items-center gap-2 flex-wrap">
            {linkedCase ? (
              <Link
                href={`/system/investigation/${linkedCase.id}`}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-[#001E2B]/30 text-sm font-medium text-[#001E2B] hover:bg-[#001E2B]/5 transition-colors"
              >
                <ShieldAlert size={14} />
                View case {linkedCase.ref}
                <ChevronRight size={13} />
              </Link>
            ) : canOpen ? (
              <button
                onClick={handleOpenInvestigation}
                disabled={openBusy}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-[#001E2B] text-white text-sm font-medium hover:bg-[#00323f] disabled:opacity-50 transition-colors"
              >
                <ShieldAlert size={14} />
                {openBusy ? 'Opening…' : 'Open investigation'}
              </button>
            ) : (
              <span className="text-xs text-gray-400 italic">Read-only: opening an investigation requires an L2 investigator.</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Amounts + rail */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-gray-800 text-sm mb-3">Payment</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Direction" value={detail.direction} />
                <Field label="Rail" value={detail.paymentExecutionRail} />
                <Field label="Gross amount" value={money(detail.grossAmount, detail.currency)} />
                <Field label="Fee" value={money(detail.feeAmount, detail.currency)} />
                <Field label="Net amount" value={money(detail.netAmount, detail.currency)} />
                {detail.recipientAmount != null && (
                  <Field label="Recipient amount" value={money(detail.recipientAmount, detail.recipientCurrency)} />
                )}
                {detail.fxRate != null && <Field label="FX rate" value={detail.fxRate} />}
                <Field label="Concept" value={detail.concept} />
                <Field label="Initiated" value={fmtDate(detail.initiatedAt)} />
                <Field label="Completed" value={fmtDate(detail.completedAt)} />
                {detail.failureReason && <Field label="Failure reason" value={detail.failureReason} />}
              </div>
            </div>

            {/* Destination (display-safe; masked account, no raw IBAN) */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><Landmark size={14} className="text-[#00684A]" /> Destination</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Beneficiary" value={detail.beneficiaryName} />
                <Field label="Beneficiary type" value={detail.beneficiaryType} />
                <Field label="Destination account" value={detail.destinationAccountMasked} />
                <Field label="Destination country" value={detail.destinationCountry} />
                <Field label="Beneficiary arrangement" value={detail.beneficiaryArrangementReference} />
                <Field label="Source account" value={detail.sourcePayoutAccountReference} />
                <Field label="Resolved account" value={detail.resolvedPayoutAccountReference} />
                {detail.merchantAgreementReference && <Field label="Merchant" value={detail.merchantAgreementReference} />}
              </div>
            </div>
          </div>

          {/* Resolution log (routing/settlement steps) */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-gray-800 text-sm mb-3">Resolution log</h2>
            {detail.resolutionLog.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-2">No resolution steps recorded.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {detail.resolutionLog.map((step, i) => (
                  <li key={`${step.stepName}-${i}`} className="py-2.5 flex items-center gap-3 text-sm">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STEP_PILL[step.stepOutcome] ?? 'bg-gray-100 text-gray-500'}`}>{step.stepOutcome}</span>
                    <span className="font-medium text-gray-800">{step.stepName}</span>
                    {step.stepNote && <span className="text-gray-500 truncate">{step.stepNote}</span>}
                    <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{fmtDate(step.stepDateTime)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
