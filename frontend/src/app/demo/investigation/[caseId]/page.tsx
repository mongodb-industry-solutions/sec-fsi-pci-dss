'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent, HrpcCheckResponse } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS, ROLE_LABELS, formatRiskIndicator } from '../../../../lib/constants';

const ACTION_LABELS: Record<string, string> = {
  case_opened: 'Case opened',
  assigned: 'Assigned',
  note_added: 'Note added',
  field_accessed: 'Sensitive field accessed',
  escalated: 'Escalated to L2',
  ai_review: 'AI pre-review',
  resolved: 'Resolved',
  closed: 'Closed',
};

const ACTION_COLORS: Record<string, string> = {
  field_accessed: 'bg-purple-100 text-purple-800',
  escalated: 'bg-yellow-100 text-yellow-800',
  case_opened: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
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

  // role/token must start with stable defaults to avoid SSR/client hydration mismatch.
  // getToken() reads localStorage which is undefined during SSR.
  // The actual values are resolved in the single mount useEffect below.
  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [userName, setUserName] = useState('');

  const isL1 = role === 'level1_analyst';
  const isL2 = role === 'level2_investigator';
  const isAuditor = role === 'security_auditor';
  const canSeeAll = isL2 || isAuditor;

  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [hrpc, setHrpc] = useState<HrpcCheckResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [rawDoc, setRawDoc] = useState<Record<string, unknown> | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Customer profile linked to the case (auto-loaded from linkedCustomerAgreementReference)
  const [customerProfile, setCustomerProfile] = useState<Record<string, unknown> | null>(null);

  // Action state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [customerNoteText, setCustomerNoteText] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [escalationToken, setEscalationToken] = useState<string | null>(null);

  async function reload(resolvedToken: string) {
    const [caseData, eventsData] = await Promise.all([
      api.fraud.getById(caseId, resolvedToken),
      api.fraud.getEvents(caseId, resolvedToken).catch(() => ({ caseId, events: [] })),
    ]);
    setFraudCase(caseData);
    setEvents(eventsData.events);

    // Auto-load the customer profile linked to this case
    if (caseData.linkedCustomerAgreementReference) {
      api.customer.getById(caseData.linkedCustomerAgreementReference, resolvedToken)
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
      router.replace('/demo/payment/history');
      return;
    }

    setToken(t);
    setRole(resolvedRole);
    setUserName(payload?.name ?? '');

    const load = async () => {
      try {
        await reload(t);
        api.hrpc.check('ACC-003', t).then(setHrpc).catch(() => null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      setRawError(null);
      try {
        const res = await api.system.rawDocument('cardTransaction', fraudCase.linkedCardTransactionReference, token);
        setRawDoc(res.document);
      } catch (err) {
        setRawError(err instanceof Error ? err.message : 'Failed to fetch');
      }
    }
    setShowRaw((v) => !v);
  }

  async function handleAction(body: Parameters<typeof api.fraud.update>[1], successMsg: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api.fraud.update(caseId, body, token);
      await reload(token);
      setActionMsg(successMsg);
      setShowNoteForm(false);
      setNoteText('');
      setCustomerNoteText('');
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

  async function handleApproveEscalation() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await api.fraud.escalateApprove(caseId, {}, token);
      setEscalationToken(res.escalationToken);
      await reload(token);
      setActionMsg('Escalation approved. Sensitive fields are now accessible.');
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader name={userName} role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6"><div className="text-center py-12 text-gray-400">Loading case...</div></main>
    </div>
  );

  if (!fraudCase) return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader name={userName} role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6"><div className="text-center py-12 text-gray-500">Case not found.</div></main>
    </div>
  );

  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  const caseStatus = fraudCase.caseStatus;
  const isResolved = ['resolved_cleared', 'resolved_fraud', 'closed'].includes(caseStatus);

  const formattedAmount = snap
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: snap.cardTransactionAmount.currency })
        .format(snap.cardTransactionAmount.amount)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader name={userName} role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/demo/investigation" className="text-sm text-blue-600 hover:underline">Back to cases</Link>
          {isAuditor && <Link href="/demo/audit" className="text-sm text-blue-600 hover:underline">Full audit log</Link>}
        </div>

        {/* ── Case header ── */}
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

        {/* ── Customer profile ── */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">Customer Profile</h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${canSeeAll ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
              {canSeeAll ? 'Full access' : 'L1 access'}
            </span>
          </div>

          {/* Auto-loaded customer profile from linkedCustomerAgreementReference */}
          {customerProfile && (
            <div className="mb-3 bg-gray-50 rounded-lg p-3 text-sm space-y-1.5">
              {[
                { label: 'Name',     key: 'customerName' },
                { label: 'Segment',  key: 'customerSegment' },
                { label: 'Status',   key: 'customerAgreementStatus' },
                { label: 'Enrolled', key: 'customerAgreementEnrollmentDate' },
              ].map(({ label, key }) =>
                customerProfile[key] ? (
                  <div key={key} className="flex gap-2">
                    <span className="text-gray-500 w-20 shrink-0 text-xs">{label}:</span>
                    <span className="font-medium text-xs capitalize">
                      {key === 'customerAgreementEnrollmentDate'
                        ? new Date(String(customerProfile[key])).toLocaleDateString()
                        : String(customerProfile[key])}
                    </span>
                  </div>
                ) : null
              )}
              {debugMode && (
                <p className="text-xs text-gray-400 mt-1 font-mono">
                  Resolved from customerAgreementInstanceReference (plaintext UUID lookup)
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border divide-y text-sm">
            {/* QE:equality fields */}
            <div className="p-3 bg-blue-50">
              {debugMode && (
                <p className="text-xs text-blue-600 mb-2 font-medium">
                  QE:equality — searchable while encrypted. Atlas stores ciphertext; queries match ciphertext-to-ciphertext.
                </p>
              )}
              <div className="space-y-2">
                {[
                  { label: 'Email',             value: canSeeAll ? 'luis.fernandez@leafybank.demo' : null },
                  { label: 'Phone',             value: canSeeAll ? '+1-555-0142' : null },
                  { label: 'Account Reference', value: canSeeAll ? 'ACC-LF-20240115' : null },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <EncryptionBadge label={label} type="qe-equality" />
                    {value
                      ? <span className="text-green-700 font-mono text-xs">{value}</span>
                      : <span className="text-gray-400 text-xs italic">Search above to verify</span>
                    }
                  </div>
                ))}
              </div>
            </div>

            {/* QE:none fields */}
            <div className={`p-3 ${canSeeAll ? 'bg-purple-50' : 'bg-gray-50'}`}>
              {debugMode && (
                <p className={`text-xs mb-2 font-medium ${canSeeAll ? 'text-purple-600' : 'text-gray-500'}`}>
                  QE:none — encrypted, not searchable. Requires DEK-sensitive (L2 escalation approval).
                </p>
              )}
              <div className="space-y-2">
                {[
                  { label: 'Physical Address', value: canSeeAll ? '742 Evergreen Terrace, Springfield' : null },
                  { label: 'Government ID',    value: canSeeAll ? 'XXX-XX-4821 (masked)' : null },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <EncryptionBadge label={label} type="qe-none" />
                    {value
                      ? <span className="text-green-700 font-mono text-xs">{value}</span>
                      : <span className="text-gray-400 text-xs italic">Requires L2 escalation approval</span>
                    }
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Notes (always visible) ── */}
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold text-sm text-gray-700">Case Notes</h2>

          {/* Internal notes – visible to L1, L2, Auditor */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Internal Notes</p>
            {fraudCase.fraudDiagnosisCaseNotes
              ? <p className="text-sm text-gray-800 bg-gray-50 rounded p-2 whitespace-pre-wrap">{fraudCase.fraudDiagnosisCaseNotes}</p>
              : <p className="text-xs text-gray-400 italic">No internal notes yet.</p>
            }
          </div>

          {/* Customer-visible notes – shown to customer in their transaction view */}
          <div>
            <p className="text-xs font-semibold text-green-700 uppercase mb-1">Customer-Visible Note</p>
            {fraudCase.fraudDiagnosisCustomerSubjectNotes
              ? <p className="text-sm text-gray-800 bg-green-50 border border-green-200 rounded p-2 whitespace-pre-wrap">{fraudCase.fraudDiagnosisCustomerSubjectNotes}</p>
              : <p className="text-xs text-gray-400 italic">No customer-facing note yet. Add one to keep the customer informed.</p>
            }
          </div>
        </div>

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

        {/* ── L1 Actions ── */}
        {isL1 && !isResolved && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">L1 Analyst Actions</h2>
            <div className="space-y-2">
              {(caseStatus === 'open' || caseStatus === 'under_review') && (
                <button
                  onClick={handleEscalate}
                  disabled={actionBusy}
                  className="w-full py-2 px-4 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  Escalate to Level 2 Investigator
                </button>
              )}
              <button
                onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_cleared', resolutionOutcome: 'cleared', resolutionNotes: 'Cleared by L1 analyst as false positive.' }, 'Case closed as false positive.')}
                disabled={actionBusy}
                className="w-full py-2 px-4 rounded-lg border border-green-600 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
              >
                Close - False Positive
              </button>
              <button onClick={() => setShowNoteForm((v) => !v)} className="w-full py-2 px-4 rounded-lg border text-gray-700 text-sm font-medium hover:bg-gray-50">
                {showNoteForm ? 'Cancel' : 'Add Notes'}
              </button>
            </div>

            {showNoteForm && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Internal note (for L2 team)</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Add context for the Level 2 investigator..."
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Customer-visible note (shown to customer in their transaction history)</label>
                  <textarea
                    value={customerNoteText}
                    onChange={(e) => setCustomerNoteText(e.target.value)}
                    rows={2}
                    placeholder="e.g. Your transaction is under security review. No action needed."
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
                <button
                  onClick={() => handleAction({
                    ...(noteText ? { fraudDiagnosisCaseNotes: noteText } : {}),
                    ...(customerNoteText ? { fraudDiagnosisCustomerSubjectNotes: customerNoteText } : {}),
                  }, 'Notes saved.')}
                  disabled={actionBusy || (!noteText && !customerNoteText)}
                  className="w-full py-2 px-4 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-medium disabled:opacity-50"
                >
                  Save Notes
                </button>
              </div>
            )}

            {actionMsg && (
              <div className={`mt-2 text-sm rounded p-2 ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </div>
            )}
          </div>
        )}

        {/* ── L2 Actions ── */}
        {isL2 && !isResolved && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">L2 Investigator Actions</h2>
            <div className="space-y-2">
              {caseStatus === 'escalated' && !escalationToken && (
                <button
                  onClick={handleApproveEscalation}
                  disabled={actionBusy}
                  className="w-full py-2 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  Approve Escalation - Access Sensitive Fields
                </button>
              )}
              {escalationToken && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs">
                  <p className="font-semibold text-purple-800 mb-1">Escalation approved - sensitive fields accessible</p>
                  {debugMode && <p className="font-mono text-purple-600">Token: {escalationToken}</p>}
                  <p className="text-purple-700">Valid for 4 hours. Include in X-Escalation-Token header.</p>
                </div>
              )}
              <button
                onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_fraud', resolutionOutcome: 'confirmed_fraud', resolutionNotes: 'Fraud confirmed by L2 investigator after full analysis.' }, 'Case resolved as confirmed fraud.')}
                disabled={actionBusy}
                className="w-full py-2 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                Confirm Fraud - Close Case
              </button>
              <button
                onClick={() => handleAction({ fraudDiagnosisCaseStatus: 'resolved_cleared', resolutionOutcome: 'cleared', resolutionNotes: 'Cleared by L2 investigator after full analysis.' }, 'Case cleared - no fraud found.')}
                disabled={actionBusy}
                className="w-full py-2 px-4 rounded-lg border border-green-600 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
              >
                Clear Case - No Fraud Found
              </button>
              <button onClick={() => setShowNoteForm((v) => !v)} className="w-full py-2 px-4 rounded-lg border text-gray-700 text-sm font-medium hover:bg-gray-50">
                {showNoteForm ? 'Cancel' : 'Add Notes'}
              </button>
            </div>

            {showNoteForm && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Investigation notes (internal)</label>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2}
                    placeholder="Document investigation findings..."
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Customer-visible note</label>
                  <textarea value={customerNoteText} onChange={(e) => setCustomerNoteText(e.target.value)} rows={2}
                    placeholder="e.g. We have completed our review. Your account has been secured."
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
                <button
                  onClick={() => handleAction({
                    ...(noteText ? { fraudDiagnosisCaseNotes: noteText } : {}),
                    ...(customerNoteText ? { fraudDiagnosisCustomerSubjectNotes: customerNoteText } : {}),
                  }, 'Notes saved.')}
                  disabled={actionBusy || (!noteText && !customerNoteText)}
                  className="w-full py-2 px-4 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-medium disabled:opacity-50"
                >
                  Save Notes
                </button>
              </div>
            )}

            {actionMsg && (
              <div className={`mt-2 text-sm rounded p-2 ${actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </div>
            )}
          </div>
        )}

        {/* ── Atlas storage (debug mode only) ── */}
        {debugMode && (
          <div className="bg-white rounded-xl border p-5">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h2 className="font-semibold">Atlas Storage</h2>
                <p className="text-xs text-gray-500">cardTransaction collection - raw ciphertext document</p>
              </div>
              <button onClick={toggleRaw} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">
                {showRaw ? 'Hide' : 'View Raw Document'}
              </button>
            </div>
            {!showRaw && <p className="text-sm text-gray-500">Shows the actual document stored in Atlas. QE-encrypted fields appear as BSON binary blobs.</p>}
            {showRaw && rawDoc && <RawDocumentPanel document={rawDoc} collection="cardTransaction" />}
            {showRaw && !rawDoc && rawError && (
              <div className="bg-gray-900 text-green-300 rounded-lg p-4 font-mono text-xs">
                <p className="text-yellow-400 mb-2">Live fetch failed ({rawError}). Representative document:</p>
                <pre>{`{
  "cardTransactionAccountReference": {
    "$binary": { "base64": "BhKJ9KMsQfY...", "subType": "06" }
  },
  "cardTransactionAmount": { "amount": 850, "currency": "USD" },
  "cardTransactionMerchantName": "Casino Royale"
}`}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Audit trail ── */}
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
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${ACTION_COLORS[e.actionType] ?? 'bg-gray-100 text-gray-700'}`}>
                    {ACTION_LABELS[e.actionType] ?? e.actionType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-500 text-xs">{PERFORMER_LABELS[e.performedByRole] ?? e.performedByRole}</span>
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

        {/* ── PCI DSS (debug mode only) ── */}
        {debugMode && (
          <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
            <strong>PCI DSS v4.0 alignment:</strong> Field-level access control via Queryable Encryption
            satisfies Requirements 3 (protect stored CHD), 7 (restrict access by business need), and
            10 (audit trail). Role boundaries are enforced at the DEK level, not just application logic.
          </div>
        )}
      </main>
    </div>
  );
}

function PageHeader({
  name,
  role,
  debugMode,
  onToggleDebug,
}: {
  name: string;
  role: string;
  debugMode: boolean;
  onToggleDebug: () => void;
}) {
  return (
    <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between">
      <span className="font-bold text-[#00ED64]">🏦 Payment Gateway</span>
      <div className="flex items-center gap-3 text-sm">
        {name && (
          <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
            {name} · {ROLE_LABELS[role] ?? role}
          </span>
        )}
        <button
          onClick={onToggleDebug}
          title="Toggle debug mode"
          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${debugMode ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64]' : 'text-gray-400 border-white/20 hover:border-white/40'}`}
        >
          <span className="hidden sm:inline">{debugMode ? 'Debug ON' : 'Debug'}</span>
        </button>
        <Link href="/demo" className="text-gray-400 hover:text-white">Sign out</Link>
      </div>
    </header>
  );
}
