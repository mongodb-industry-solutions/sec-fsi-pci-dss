'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent, HrpcCheckResponse, CaseEnrichment } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { RawMongoPanel } from '../../../../components/RawMongoPanel';
import { CaseNotesPanel } from '../../../../components/CaseNotesPanel';
import { CaseQuestionsPanel } from '../../../../components/CaseQuestionsPanel';
import { useCaseStream } from '../../../../lib/useCaseStream';
import { SEVERITY_COLORS, STATUS_COLORS, ROLE_LABELS, formatRiskIndicator } from '../../../../lib/constants';
import { useDebugMode } from '../../../../lib/debugMode';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { storeEscalationToken } from '../../../../lib/escalation';
import { ArrowUpFromLine, CheckCircle, XCircle, ShieldAlert, Activity, Store, CreditCard, UserCheck, ChevronRight, RotateCcw } from 'lucide-react';
import { useConfirm } from '../../../../components/ui/ConfirmProvider';

const ACTION_LABELS: Record<string, string> = {
  case_opened: 'Case opened',
  assigned: 'Assigned',
  note_added: 'Note added',
  field_accessed: 'Sensitive field accessed',
  escalated: 'Escalated to L2',
  ai_review: 'AI pre-review',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
};

const ACTION_COLORS: Record<string, string> = {
  field_accessed: 'bg-purple-100 text-purple-800',
  escalated: 'bg-yellow-100 text-yellow-800',
  case_opened: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
  reopened: 'bg-blue-100 text-blue-800',
  note_added: 'bg-gray-100 text-gray-700',
};

const PERFORMER_LABELS: Record<string, string> = {
  payment_service: 'System - Automated detection',
  level1_analyst: 'L1 Analyst',
  level2_investigator: 'L2 Investigator',
  security_auditor: 'Security Auditor',
  ai_agent: 'AI Agent',
};

const HRPC_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  none: 'bg-green-100 text-green-800 border-green-200',
};

export default function DemoCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const router = useRouter();
  const confirm = useConfirm();

  // role/token must start with stable defaults to avoid SSR/client hydration mismatch.
  // getToken() reads localStorage which is undefined during SSR.
  // The actual values are resolved in the single mount useEffect below.
  const { debugMode } = useDebugMode();
  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');

  const isL1 = role === 'level1_analyst';
  const isL2 = role === 'level2_investigator';
  const isAuditor = role === 'security_auditor';
  const canSeeAll = isL2 || isAuditor;

  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [hrpc, setHrpc] = useState<HrpcCheckResponse | null>(null);
  const [enrichment, setEnrichment] = useState<CaseEnrichment | null>(null);
  const [loading, setLoading] = useState(true);

  // Customer profile linked to the case (auto-loaded from customerAgreementInstanceReference)
  const [customerProfile, setCustomerProfile] = useState<Record<string, unknown> | null>(null);

  // Action state
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [escalationToken, setEscalationToken] = useState<string | null>(null);
  const [liveSignal, setLiveSignal] = useState(0);

  // ADR-031: live updates via SSE — when the customer answers a question, refresh the case + panel.
  useCaseStream(caseId, token, () => { if (token) reload(token); setLiveSignal((s) => s + 1); });

  async function reload(resolvedToken: string) {
    const [caseData, eventsData] = await Promise.all([
      api.fraud.getById(caseId, resolvedToken),
      api.fraud.getEvents(caseId, resolvedToken).catch(() => ({ caseId, events: [] })),
    ]);
    setFraudCase(caseData);
    setEvents(eventsData.events);

    // Auto-load the customer profile linked to this case
    if (caseData.customerAgreementInstanceReference) {
      api.customer.getById(caseData.customerAgreementInstanceReference, resolvedToken)
        .then(setCustomerProfile)
        .catch(() => null);
    }

    return caseData;
  }

  // Single mount effect: read token, derive role, then load case data.
  // Separating these into two effects would cause a double load when token
  // transitions from '' to the real value.
  useEffect(() => {
    const t = getToken() ?? '';
    const payload = decodeToken(t);
    const resolvedRole = payload?.role ?? 'level1_analyst';

    // Customers must not access investigation cases directly
    if (resolvedRole === 'customer') {
      router.replace('/system/payment/history');
      return;
    }
    // Investigation is restricted to fraud analyst/auditor roles. Manager, merchant_officer
    // and any other authenticated role are redirected to their hub (mirrors the server guard).
    if (!['level1_analyst', 'level2_investigator', 'security_auditor'].includes(resolvedRole)) {
      router.replace('/system');
      return;
    }

    setToken(t);
    setRole(resolvedRole);

    const load = async () => {
      try {
        await reload(t);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resume escalation: an L2 who has already accepted this case re-derives a fresh
  // stateless token on load (idempotent on the backend; no audit-trail noise), so sensitive
  // fields stay accessible across reloads and into linked entity pages without re-clicking.
  useEffect(() => {
    if (role !== 'level2_investigator' || !fraudCase || !token || escalationToken) return;
    if (fraudCase.caseStatus !== 'escalated' || !fraudCase.escalationAcceptedAt) return;
    api.fraud.escalateApprove(caseId, {}, token)
      .then((res) => { setEscalationToken(res.escalationToken); storeEscalationToken(caseId, res.escalationToken); })
      .catch(() => {});
  }, [role, fraudCase, token, escalationToken, caseId]);

  // Load the aggregated enrichment read-model. Re-runs when the escalation token changes so
  // sensitive KYC unlocks in place. HRP is derived from the real account reference here (no
  // hardcoded lookup). Eventual consistency: the read-model reports `asOf` and pending fields.
  useEffect(() => {
    if (!token || !caseId) return;
    api.fraud.enrichment(caseId, token, escalationToken ?? undefined)
      .then((e) => {
        setEnrichment(e);
        if (e.hrp?.available && e.hrp.match) {
          setHrpc({
            accountRef: e.references.accountRef ?? '',
            hrpcMatch: !!e.hrp.match,
            highestRiskLevel: e.hrp.highestRiskLevel ?? 'none',
            hrpcFlags: (e.hrp.flags ?? []) as HrpcCheckResponse['hrpcFlags'],
          });
        } else {
          setHrpc(null);
        }
      })
      .catch(() => null);
  }, [token, caseId, escalationToken]);

  async function handleAction(body: Parameters<typeof api.fraud.update>[1], successMsg: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.fraud.update(caseId, body, token);
      await reload(token);
      setActionMsg(successMsg);
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  // Reopen a resolved/closed case (L1/L2 only; auditor is read-only). Confirm, set status back to
  // 'open', then reload. The backend records a 'reopened' audit event (SD-83, PCI DSS Req 10).
  async function handleReopen() {
    const ok = await confirm({
      title: 'Reopen this case?',
      message: 'This returns the case to the open state for further review. The action is recorded in the audit trail.',
      confirmLabel: 'Reopen case',
    });
    if (!ok) return;
    await handleAction({ fraudDiagnosisCaseStatus: 'open' }, 'Case reopened.');
  }

  async function handleCancelEscalation() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.fraud.update(caseId, { fraudDiagnosisCaseStatus: 'under_review' }, token);
      await reload(token);
      setActionMsg('Escalation cancelled. Case returned to under review.');
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleEscalate() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.fraud.escalate(caseId, { escalationReason: 'Risk exceeds L1 threshold. Requesting L2 review.' }, token);
      await reload(token);
      setActionMsg('Case escalated to Level 2 Investigator.');
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRejectEscalation() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.fraud.escalateReject(caseId, {}, token);
      await reload(token);
      setActionMsg('Escalation rejected. Case returned to L1 for re-analysis.');
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleApproveEscalation() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await api.fraud.escalateApprove(caseId, {}, token);
      setEscalationToken(res.escalationToken);
      storeEscalationToken(caseId, res.escalationToken); // persist so it survives reload/navigation
      await reload(token);
      setActionMsg('Escalation approved. Sensitive fields are now accessible.');
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-center py-12 text-gray-400">Loading case...</div>
    </div>
  );

  if (!fraudCase) return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-center py-12 text-gray-500">Case not found.</div>
    </div>
  );

  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  const caseStatus = fraudCase.caseStatus;
  const isResolved = ['resolved_cleared', 'resolved_fraud', 'closed'].includes(caseStatus);
  const isEscalated = caseStatus === 'escalated';
  // Persisted on the case document - survives page refresh
  const l2HasAccepted = !!fraudCase.escalationAcceptedAt;

  const formattedAmount = snap
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: snap.cardTransactionAmount.currency })
        .format(snap.cardTransactionAmount.amount)
    : null;

  return (
    <div className="min-h-full bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <Breadcrumb items={[
            { label: 'Home', href: '/system' },
            { label: 'Cases', href: '/system/investigation' },
            { label: fraudCase.fraudDiagnosisCaseReference ?? 'Case' },
          ]} />
          {isAuditor && <Link href="/system/audit" className="text-sm text-blue-600 hover:underline">Full audit log</Link>}
        </div>

        {/* -- Case header -- */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex gap-3 items-center mb-4 flex-wrap">
            <h1 className="text-xl font-bold">{fraudCase.fraudDiagnosisCaseReference}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[fraudCase.riskSeverity] ?? ''}`}>
              {fraudCase.riskSeverity.toUpperCase()}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[fraudCase.caseStatus] ?? ''}`}>
              {fraudCase.caseStatus.replace(/_/g, ' ')}
            </span>
            <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${
              canSeeAll ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-blue-100 text-blue-700 border-blue-300'
            }`}>
              {ROLE_LABELS[role] ?? role}
            </span>
          </div>

          {/* Transaction */}
          {snap && (
            <div className="bg-gray-50 rounded-lg p-4 mb-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-gray-500">Amount:</span>
                <span className="font-semibold text-red-700">{formattedAmount}</span>
                <span className="text-gray-500">Merchant:</span>
                <span className="font-medium">{snap.cardTransactionMerchantName}</span>
                <span className="text-gray-500">Card:</span>
                <span className="font-mono">{snap.cardTransactionMaskedPanDisplay}</span>
                <span className="text-gray-500">Date:</span>
                <span>{new Date(snap.cardTransactionDateTime).toLocaleString()}</span>
                <span className="text-gray-500">Status:</span>
                <span className="capitalize">{snap.cardTransactionStatus}</span>
              </div>
            </div>
          )}

          {/* Risk score */}
          {score !== undefined && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1 text-sm">
                <span className="text-gray-600">Risk Score:</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className={`h-2 rounded-full ${score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-400' : 'bg-yellow-400'}`} style={{ width: `${score}%` }} />
                </div>
                <span className="font-bold text-red-700 text-sm">{score}/100</span>
              </div>
              {indicators.length > 0 && (
                <ul className="space-y-1">
                  {indicators.map((ind) => (
                    <li key={ind} className="flex items-start gap-2 text-sm">
                      <span className="text-amber-500 font-bold mt-0.5">!</span>
                      {formatRiskIndicator(ind)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* HRPC */}
          {hrpc?.hrpcMatch && (
            <div className={`border rounded-lg p-3 text-sm ${HRPC_COLORS[hrpc.highestRiskLevel]}`}>
              <p className="font-semibold mb-1">HRPC Risk - {hrpc.highestRiskLevel.toUpperCase()}</p>
              <ul className="text-xs space-y-0.5">
                {hrpc.hrpcFlags.map((f) => (
                  <li key={f.category}><span className="font-medium">{f.label}:</span> {f.description}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* -- Investigation enrichment (read-model: operation + SDF history + KYB + KYC) -- */}
        {enrichment && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Operation */}
            {enrichment.operation && (
              <div className="bg-white rounded-xl border p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard size={15} className="text-[#001E2B]" />
                  <h2 className="font-semibold text-sm">Operation</h2>
                  <Link href={`/system/transactions/${enrichment.operation.transactionId}?from=investigation&caseId=${caseId}&caseRef=${encodeURIComponent(fraudCase.fraudDiagnosisCaseReference ?? '')}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                    Open transaction <ChevronRight size={12} />
                  </Link>
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#001E2B] text-[#00ED64] capitalize">{enrichment.operation.type.replace(/_/g, ' ')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                    enrichment.operation.status === 'disputed' ? 'bg-red-100 text-red-700' :
                    enrichment.operation.status === 'declined' ? 'bg-gray-200 text-gray-600' :
                    'bg-green-100 text-green-700'
                  }`}>{enrichment.operation.status}</span>
                  {enrichment.operation.channel && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{enrichment.operation.channel}</span>}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-gray-500">Amount:</span>
                  <span className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: enrichment.operation.amount.currency }).format(enrichment.operation.amount.amount)}</span>
                  <span className="text-gray-500">Merchant:</span>
                  <span className="font-medium truncate">{enrichment.operation.merchantName}</span>
                  <span className="text-gray-500">MCC:</span>
                  <span className="font-mono text-xs">{enrichment.operation.merchantCategoryCode ?? '-'}</span>
                  <span className="text-gray-500">Card:</span>
                  <span className="font-mono text-xs">{enrichment.operation.maskedPan}</span>
                  {enrichment.operation.description && (<><span className="text-gray-500">Descriptor:</span><span className="truncate">{enrichment.operation.description}</span></>)}
                </div>
              </div>
            )}

            {/* SDF; detection signal + history */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert size={15} className="text-[#001E2B]" />
                <h2 className="font-semibold text-sm">Fraud Detection (SDF)</h2>
                <span className="ml-auto text-xs text-gray-400">{enrichment.sdf?.scorePending ? 'score pending' : `score ${enrichment.sdf?.score ?? '-'}/100`}</span>
              </div>
              {enrichment.sdf?.conclusion && <p className="text-sm text-gray-700 mb-2">{enrichment.sdf.conclusion}</p>}
              {(enrichment.sdf?.events?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-400">No detection events recorded yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(enrichment.sdf?.events ?? []).map((ev, i) => (
                    <li key={i} className="text-xs flex items-start gap-2">
                      <span className={`mt-0.5 px-1.5 py-0.5 rounded-full font-medium ${ev.outcome === 'rejected' || ev.outcome === 'failed' ? 'bg-red-100 text-red-700' : ev.outcome === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>{ev.outcome}</span>
                      <div className="min-w-0">
                        <span className="font-mono text-[#001E2B]">{ev.action}</span>
                        <span className="text-gray-400"> · {new Date(ev.dateTime).toLocaleString()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {debugMode && <p className="mt-3 text-[10px] font-mono text-gray-400">SD-83 · processType fraud_evaluation · asOf {new Date(enrichment.asOf).toLocaleTimeString()}</p>}
            </div>

            {/* Merchant; acquired (KYB record) or external (descriptor only, no KYB) */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-3">
                <Store size={15} className="text-[#001E2B]" />
                <h2 className="font-semibold text-sm">Merchant{enrichment.kyb ? ' (KYB)' : ''}</h2>
                {enrichment.kyb && (
                  <Link href={`/system/merchant/${enrichment.kyb.merchantId}?from=investigation&caseId=${caseId}&caseRef=${encodeURIComponent(fraudCase.fraudDiagnosisCaseReference ?? '')}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                    Open merchant <ChevronRight size={12} />
                  </Link>
                )}
              </div>
              {enrichment.kyb ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-gray-500">Name:</span>
                  <span className="font-medium truncate">{enrichment.kyb.name}</span>
                  <span className="text-gray-500">Status:</span>
                  <span className="capitalize">{enrichment.kyb.status}</span>
                  <span className="text-gray-500">KYB check:</span>
                  <span className="capitalize">{(enrichment.kyb.kybCheck as { merchantAgreementKybCheckStatus?: string } | null)?.merchantAgreementKybCheckStatus ?? 'n/a'}</span>
                  <span className="text-gray-500">Risk:</span>
                  <span className="capitalize">{enrichment.kyb.riskCategory ?? '-'}{enrichment.kyb.tier ? ` · ${enrichment.kyb.tier}` : ''}</span>
                  <span className="text-gray-500">Country / MCC:</span>
                  <span className="font-mono text-xs">{enrichment.kyb.countryCode ?? '-'} / {enrichment.kyb.categoryCode ?? '-'}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <span className="text-gray-500">Descriptor:</span>
                    <span className="font-medium truncate">{enrichment.operation?.merchantName ?? '-'}</span>
                    <span className="text-gray-500">MCC:</span>
                    <span className="font-mono text-xs">{enrichment.operation?.merchantCategoryCode ?? '-'}</span>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    External merchant: not acquired by this PSP, so there is no KYB record. Only the card-network
                    descriptor (name + MCC) is available. This is expected for issuer-side transactions{debugMode ? ' (BIAN SD-89 applies only to acquired merchants).' : '.'}
                  </div>
                </div>
              )}
            </div>

            {/* KYC; single, unified customer card (summary + contact + sensitive, role-gated) */}
            {enrichment.kyc && (
              <div className="bg-white rounded-xl border p-5">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <UserCheck size={15} className="text-[#001E2B]" />
                  <h2 className="font-semibold text-sm">Customer (KYC)</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${enrichment.kyc.sensitiveUnlocked ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                    {enrichment.kyc.sensitiveUnlocked ? 'PII unlocked' : 'Summary only'}
                  </span>
                  <Link href={`/system/users/${enrichment.kyc.customerId}?from=investigation&caseId=${caseId}&caseRef=${encodeURIComponent(fraudCase.fraudDiagnosisCaseReference ?? '')}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                    Open profile <ChevronRight size={12} />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-gray-500">Name:</span>
                  <span className="font-medium truncate">{enrichment.kyc.name ?? '-'}</span>
                  <span className="text-gray-500">Segment:</span>
                  <span className="capitalize">{enrichment.kyc.segment ?? '-'}</span>
                  <span className="text-gray-500">Status:</span>
                  <span className="capitalize">{enrichment.kyc.status ?? '-'}</span>
                  <span className="text-gray-500">Enrolled:</span>
                  <span>{enrichment.kyc.enrollmentDate ? new Date(enrichment.kyc.enrollmentDate).toLocaleDateString() : '-'}</span>
                  <span className="text-gray-500">KYC check:</span>
                  <span className="capitalize">{(enrichment.kyc.kycCheck as { customerAgreementKycCheckStatus?: string } | null)?.customerAgreementKycCheckStatus ?? 'n/a'}</span>
                  {enrichment.kyc.email && (<><span className="text-gray-500">Email:</span><span className="font-mono text-xs truncate">{enrichment.kyc.email}</span></>)}
                  {enrichment.kyc.phone && (<><span className="text-gray-500">Phone:</span><span className="font-mono text-xs">{enrichment.kyc.phone}</span></>)}
                </div>
                {enrichment.kyc.contactRestricted && (
                  <p className="mt-2 text-xs text-gray-400 italic">Contact PII (email, phone) is restricted at L1 (need-to-know); available to L2 and auditor.</p>
                )}
                {enrichment.kyc.sensitive ? (
                  <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3">
                    {(() => {
                      const s = enrichment.kyc.sensitive as { customerAgreementResidentialAddress?: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }; governmentIdentificationReference?: string; customerAgreementRiskNotes?: string };
                      const addr = s.customerAgreementResidentialAddress;
                      return (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                          {addr && (<><span className="text-gray-500">Address:</span><span className="font-mono text-xs break-all">{[addr.streetAddress, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ')}</span></>)}
                          {s.governmentIdentificationReference && (<><span className="text-gray-500">Gov ID:</span><span className="font-mono text-xs">{s.governmentIdentificationReference}</span></>)}
                          {s.customerAgreementRiskNotes && (<><span className="text-gray-500">Risk notes:</span><span className="text-xs">{s.customerAgreementRiskNotes}</span></>)}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-gray-400 italic">Sensitive PII (address, government ID, risk notes) requires {isAuditor ? 'auditor access' : 'L2 escalation acceptance'}.</p>
                )}
                {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">SD-53 · QE:equality (email/phone) · QE:none (address, gov ID, risk notes)</p>}
              </div>
            )}
          </div>
        )}

        {/* -- Notes -- */}
        {token && <CaseNotesPanel caseId={caseId} token={token} role={role} onActivity={() => reload(token)} />}

        {/* -- Customer questions (ADR-031) -- */}
        {token && <CaseQuestionsPanel caseId={caseId} token={token} role={role} onActivity={() => reload(token)} refreshSignal={liveSignal} />}

        {fraudCase.fraudDiagnosisResolutionRecord && (
          <div className={`rounded-xl border p-4 text-sm ${fraudCase.fraudDiagnosisResolutionRecord.resolutionOutcome === 'confirmed_fraud' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <p className="font-semibold mb-1">
              {fraudCase.fraudDiagnosisResolutionRecord.resolutionOutcome === 'confirmed_fraud' ? 'Confirmed Fraud' : 'Cleared - False Positive'}
            </p>
            {fraudCase.fraudDiagnosisResolutionRecord.resolutionNotes && (
              <p className="text-gray-700">{fraudCase.fraudDiagnosisResolutionRecord.resolutionNotes}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {new Date(fraudCase.fraudDiagnosisResolutionRecord.resolutionDateTime).toLocaleString()}
            </p>
          </div>
        )}

        {/* -- Reopen a resolved/closed case (L1/L2 only; auditor read-only) -- */}
        {isResolved && (isL1 || isL2) && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">Case reopening</h2>
            <button
              onClick={handleReopen}
              disabled={actionBusy}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-blue-600 text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              <RotateCcw size={14} />
              Reopen case
            </button>
            {actionMsg && (
              <div className={`mt-2 text-sm rounded p-2 ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </div>
            )}
          </div>
        )}

        {/* -- L1 Actions -- */}
        {isL1 && !isResolved && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">L1 Analyst Actions</h2>
            <div className="space-y-2">
              {/* Not escalated: normal actions */}
              {!isEscalated && (
                <>
                  {(caseStatus === 'open' || caseStatus === 'under_review') && (
                    <button
                      onClick={handleEscalate}
                      disabled={actionBusy}
                      className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      <ArrowUpFromLine size={14} />
                      Escalate to Level 2 Investigator
                    </button>
                  )}
                  <button
                    onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_cleared', resolutionOutcome: 'cleared', resolutionNotes: 'Cleared by L1 analyst as false positive.' }, 'Case closed as false positive.')}
                    disabled={actionBusy}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-green-600 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={14} />
                    Close - False Positive
                  </button>
                </>
              )}

              {/* Escalated: cancel only if L2 hasn't accepted yet */}
              {isEscalated && !l2HasAccepted && (
                <button
                  onClick={handleCancelEscalation}
                  disabled={actionBusy}
                  className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-amber-500 text-amber-700 text-sm font-medium hover:bg-amber-50 disabled:opacity-50 transition-colors"
                >
                  <XCircle size={14} />
                  Cancel Escalation
                </button>
              )}

              {/* Escalated and L2 accepted: read-only notice */}
              {isEscalated && l2HasAccepted && (
                <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
                  L2 investigator has accepted this case. No further actions available for L1.
                </div>
              )}

            </div>

            {actionMsg && (
              <div className={`mt-2 text-sm rounded p-2 ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </div>
            )}
          </div>
        )}

        {/* -- L2 Actions -- */}
        {isL2 && !isResolved && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">L2 Investigator Actions</h2>
            <div className="space-y-2">
              {/* Approve: only when escalated and not yet accepted */}
              {isEscalated && !l2HasAccepted && (
                <button
                  onClick={handleApproveEscalation}
                  disabled={actionBusy}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  <ShieldAlert size={14} />
                  Approve Escalation - Access Sensitive Fields
                </button>
              )}
              {/* Accepted state: token info + reject + resolution buttons */}
              {isEscalated && l2HasAccepted && (
                <>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs">
                    <p className="font-semibold text-purple-800 mb-1">Escalation accepted - sensitive fields accessible</p>
                    {escalationToken && debugMode && <p className="font-mono text-purple-600">Token: {escalationToken}</p>}
                    {!escalationToken && <p className="text-purple-700 italic">Re-open this page or click below to renew your access token.</p>}
                    <button
                      onClick={handleApproveEscalation}
                      disabled={actionBusy}
                      className="mt-2 text-xs px-2 py-1 rounded border border-purple-400 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                    >
                      Renew access token
                    </button>
                  </div>
                  <button
                    onClick={handleRejectEscalation}
                    disabled={actionBusy}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-amber-500 text-amber-700 text-sm font-medium hover:bg-amber-50 disabled:opacity-50 transition-colors"
                  >
                    <XCircle size={14} />
                    Reject Escalation - Return to L1
                  </button>
                  <button
                    onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_fraud', resolutionOutcome: 'confirmed_fraud', resolutionNotes: 'Fraud confirmed by L2 investigator after full analysis.' }, 'Case resolved as confirmed fraud.')}
                    disabled={actionBusy}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    <XCircle size={14} />
                    Confirm Fraud - Close Case
                  </button>
                  <button
                    onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_cleared', resolutionOutcome: 'cleared', resolutionNotes: 'Cleared by L2 investigator after full analysis.' }, 'Case cleared - no fraud found.')}
                    disabled={actionBusy}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-green-600 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle size={14} />
                    Clear Case - No Fraud Found
                  </button>
                </>
              )}
            </div>

            {actionMsg && (
              <div className={`mt-2 text-sm rounded p-2 ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </div>
            )}
          </div>
        )}

        {/* -- Audit trail -- */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3">Activity Log</h2>
          {events.length === 0 ? (
            <p className="text-sm text-gray-400">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {events.map((e, i) => (
                <div key={i} className="flex gap-3 text-sm py-1.5 border-b last:border-0 items-start">
                  <span className="text-gray-400 font-mono text-xs whitespace-nowrap mt-0.5">
                    {new Date(e.actionDateTime).toLocaleString()}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                    e.actionType === 'assigned' && e.actionDetails?.action === 'escalation_rejected' ? 'bg-red-100 text-red-700' :
                    e.actionType === 'assigned' && e.actionDetails?.action === 'escalation_cancelled' ? 'bg-amber-100 text-amber-700' :
                    ACTION_COLORS[e.actionType] ?? 'bg-gray-100 text-gray-700'
                  }`}>
                    {e.actionType === 'assigned' && e.actionDetails?.action === 'escalation_rejected' ? 'Escalation rejected by L2' :
                     e.actionType === 'assigned' && e.actionDetails?.action === 'escalation_cancelled' ? 'Escalation cancelled by L1' :
                     ACTION_LABELS[e.actionType] ?? e.actionType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {e.performedByName && e.performedByInstanceReference !== 'system'
                      ? <><span className="font-medium text-gray-700">{e.performedByName}</span> · {PERFORMER_LABELS[e.performedByRole] ?? e.performedByRole}</>
                      : <>{PERFORMER_LABELS[e.performedByRole] ?? e.performedByRole}</>}
                    {debugMode && e.performedByInstanceReference && !['rbac-layer', 'system'].includes(e.performedByInstanceReference) && (
                      <span className="font-mono text-gray-400"> · {e.performedByInstanceReference.slice(0, 8)}</span>
                    )}
                  </span>
                  {debugMode && e.actionDetails && Object.keys(e.actionDetails).length > 0 && (
                    <pre className="mt-1 w-full text-xs font-mono text-gray-400 bg-gray-50 rounded px-2 py-1 whitespace-pre-wrap break-all">
                      {JSON.stringify(e.actionDetails, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -- PCI DSS (debug mode only) -- */}
        {debugMode && (
          <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
            <strong>PCI DSS v4.0 alignment:</strong> Field-level access control via Queryable Encryption
            satisfies Requirements 3 (protect stored CHD), 7 (restrict access by business need), and
            10 (audit trail). Role boundaries are enforced at the DEK level, not just application logic.
          </div>
        )}

        {/* -- Debug: raw JSON -- */}
        {debugMode && (
          <RawMongoPanel
            token={token}
            title="⚙ Debug - Raw JSON"
            sections={[
              {
                kind: 'static',
                label: 'API - GET /api/v1/fraud/:id',
                labelColor: 'text-yellow-400',
                description: 'Fraud case document (application layer response)',
                data: fraudCase,
              },
              {
                kind: 'static',
                label: 'API - GET /api/v1/fraud/:id/events',
                labelColor: 'text-yellow-400',
                description: 'Audit trail events',
                data: events,
              },
              {
                kind: 'static',
                label: 'API - GET /api/v1/fraud/hrpc/check',
                labelColor: 'text-yellow-400',
                description: 'HRPC risk profile for the linked account',
                data: hrpc,
              },
              {
                kind: 'static',
                label: 'API - GET /api/v1/customer/by-id/:id',
                labelColor: 'text-yellow-400',
                description: 'Customer agreement profile (auto-loaded from customerAgreementInstanceReference)',
                data: customerProfile,
              },
              {
                kind: 'mongo',
                collection: 'fraudDiagnosisCase',
                id: caseId,
                label: 'fraudDiagnosisCase',
                description: 'Raw fraud case document as stored in Atlas (SD-83)',
              },
              {
                kind: 'mongo',
                collection: 'cardTransactionLog',
                id: fraudCase.cardTransactionInstanceReference,
                label: 'cardTransactionLog',
                description: 'QE:equality (accountRef) + QE:none (rawGatewayPayload, processorMetadata) - BSON ciphertext',
              },
              {
                kind: 'mongo',
                collection: 'customerAgreementProcedure',
                id: fraudCase.customerAgreementInstanceReference,
                label: 'customerAgreementProcedure',
                description: 'QE:equality (accountRef) + QE:none (address, govId, riskNotes) - BSON ciphertext',
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}
