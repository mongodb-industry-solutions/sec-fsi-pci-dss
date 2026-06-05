'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent, HrpcCheckResponse } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS, ROLE_LABELS, formatRiskIndicator } from '../../../../lib/constants';

const ACTION_TYPE_LABELS: Record<string, string> = {
  case_opened: 'Case Opened',
  assigned: 'Assigned',
  note_added: 'Note Added',
  field_accessed: 'Sensitive Field Accessed',
  escalated: 'Escalated to L2',
  ai_review: 'AI Pre-Review',
  resolved: 'Resolved',
  closed: 'Closed',
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  field_accessed: 'bg-purple-100 text-purple-800',
  escalated: 'bg-yellow-100 text-yellow-800',
  case_opened: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
};

const HRPC_LEVEL_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
  none: 'bg-green-100 text-green-800 border-green-200',
};

export default function DemoCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const token = getToken() ?? '';
  const payload = decodeToken(token);
  const role = payload?.role ?? 'level1_analyst';
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
  const [escalating, setEscalating] = useState(false);
  const [escalationDone, setEscalationDone] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [caseData, eventsData] = await Promise.all([
          api.fraud.getById(caseId, token),
          api.fraud.getEvents(caseId, token).catch(() => ({ caseId, events: [] })),
        ]);
        setFraudCase(caseData);
        setEvents(eventsData.events);

        // Attempt HRPC check using the case's customer reference as a stand-in (demo)
        // In a real system this would use the resolved account reference from the customer record.
        if (caseData.linkedCustomerAgreementReference) {
          api.hrpc.check('ACC-003', token)
            .then(setHrpc)
            .catch(() => null);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [caseId, token]);

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      setRawError(null);
      try {
        const res = await api.system.rawDocument('cardTransaction', fraudCase.linkedCardTransactionReference, token);
        setRawDoc(res.document);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        setRawError(msg);
      }
    }
    setShowRaw((v) => !v);
  }

  async function handleEscalate() {
    if (!fraudCase) return;
    setEscalating(true);
    try {
      await api.fraud.escalate(caseId, { escalationReason: 'Risk score exceeds L1 threshold. Requesting L2 review.' }, token);
      setEscalationDone(true);
      const updated = await api.fraud.getById(caseId, token);
      setFraudCase(updated);
      const eventsData = await api.fraud.getEvents(caseId, token).catch(() => ({ caseId, events: [] }));
      setEvents(eventsData.events);
    } catch {
      // Escalation may fail if case is already escalated
    } finally {
      setEscalating(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6">
        <div className="text-center py-12 text-gray-400">Loading case...</div>
      </main>
    </div>
  );

  if (!fraudCase) return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6">
        <div className="text-center py-12 text-gray-500">Case not found.</div>
      </main>
    </div>
  );

  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  const caseStatus = fraudCase.caseStatus;

  const formattedAmount = snap
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: snap.cardTransactionAmount.currency,
      }).format(snap.cardTransactionAmount.amount)
    : null;

  const canEscalate = role === 'level1_analyst' && (caseStatus === 'open' || caseStatus === 'under_review') && !escalationDone;

  return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} debugMode={debugMode} onToggleDebug={() => setDebugMode((v) => !v)} />
      <main className="max-w-2xl mx-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/demo/investigation" className="text-sm text-blue-600 hover:underline">
            Back to cases
          </Link>
          {isAuditor && (
            <Link href="/demo/audit" className="text-sm text-blue-600 hover:underline">
              View full audit log
            </Link>
          )}
        </div>

        {/* Case header */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex gap-3 items-center mb-3 flex-wrap">
            <h1 className="text-xl font-bold">{fraudCase.fraudDiagnosisCaseReference}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[fraudCase.riskSeverity] ?? ''}`}>
              {fraudCase.riskSeverity.toUpperCase()}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[fraudCase.caseStatus] ?? ''}`}>
              {fraudCase.caseStatus.replace(/_/g, ' ')}
            </span>
            <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${
              canSeeAll
                ? 'bg-purple-100 text-purple-700 border-purple-300'
                : 'bg-blue-100 text-blue-700 border-blue-300'
            }`}>
              {ROLE_LABELS[role] ?? role}
            </span>
          </div>

          {/* Transaction details */}
          {snap && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-gray-700 mb-2">Transaction Details</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-gray-500">Amount:</span>
                <span className="font-semibold text-red-700">{formattedAmount}</span>
                <span className="text-gray-500">Merchant:</span>
                <span className="font-medium">{snap.cardTransactionMerchantName}</span>
                <span className="text-gray-500">Card (masked):</span>
                <span className="font-mono">{snap.cardTransactionMaskedPanDisplay}</span>
                <span className="text-gray-500">Date / Time:</span>
                <span>{new Date(snap.cardTransactionDateTime).toLocaleString()}</span>
                <span className="text-gray-500">Txn Status:</span>
                <span className="capitalize">{snap.cardTransactionStatus}</span>
              </div>
            </div>
          )}

          {debugMode && (
            <div className="mt-3 bg-[#001E2B]/5 border border-[#001E2B]/20 rounded p-3 text-xs font-mono text-gray-600">
              <p className="font-semibold mb-1 text-[#001E2B]">Debug - Case identifiers</p>
              <p>Case ID: {fraudCase.fraudDiagnosisInstanceReference}</p>
              <p>Transaction ref: {fraudCase.linkedCardTransactionReference}</p>
              <p>Customer ref: {fraudCase.linkedCustomerAgreementReference}</p>
            </div>
          )}
        </div>

        {/* Risk assessment */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3">Risk Assessment</h2>
          {score !== undefined && (
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-gray-600">Fraud Score:</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-400' : 'bg-yellow-400'}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <span className="font-bold text-red-700 text-sm">{score}/100</span>
            </div>
          )}
          {indicators.length > 0 ? (
            <ul className="space-y-2">
              {indicators.map((ind) => (
                <li key={ind} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-500 font-bold mt-0.5">!</span>
                  <span>{formatRiskIndicator(ind)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No risk indicators recorded.</p>
          )}

          {/* HRPC indicator */}
          {hrpc && hrpc.hrpcMatch && (
            <div className={`mt-3 border rounded-lg p-3 text-sm ${HRPC_LEVEL_COLORS[hrpc.highestRiskLevel]}`}>
              <p className="font-semibold mb-1">
                HRPC Risk Flag - {hrpc.highestRiskLevel.toUpperCase()} risk
              </p>
              <ul className="space-y-1 text-xs">
                {hrpc.hrpcFlags.map((f) => (
                  <li key={f.category}>
                    <span className="font-medium">{f.label}:</span> {f.description}
                  </li>
                ))}
              </ul>
              {debugMode && (
                <p className="text-xs mt-2 opacity-70">Source: HRPC check via /api/v1/fraud/hrpc/check</p>
              )}
            </div>
          )}
          {hrpc && !hrpc.hrpcMatch && debugMode && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700">
              HRPC check: no flags found for this account reference.
            </div>
          )}
        </div>

        {/* Customer Profile - role-aware */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">Customer Profile</h2>
            <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${
              canSeeAll ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {canSeeAll ? 'Full Access' : 'L1 Access'}
            </span>
          </div>

          {/* L1 context: what L1 can do operationally */}
          {!canSeeAll && (
            <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <p className="font-semibold mb-1">L1 Analyst: Available actions</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Search customer by email, phone, or account reference (QE equality search)</li>
                <li>View transaction history by card token</li>
                <li>Review risk score and fraud indicators</li>
                <li>Add investigation notes</li>
                <li>Escalate to L2 if risk exceeds threshold</li>
              </ul>
            </div>
          )}

          <div className="rounded-lg border divide-y text-sm">
            {/* QE:equality fields */}
            <div className="p-3 bg-blue-50">
              <p className="text-xs font-semibold text-blue-700 uppercase mb-2">
                QE:equality - Searchable while encrypted
              </p>
              {debugMode && (
                <p className="text-xs text-blue-600 mb-2">
                  These fields are queryable by exact match. The server never sees the plaintext.
                  Ciphertext-to-ciphertext comparison happens inside the MongoDB driver.
                </p>
              )}
              <div className="space-y-2">
                {[
                  { label: 'Email', value: canSeeAll ? 'luis.fernandez@leafybank.demo' : null, hint: 'Use QE search to look up this customer' },
                  { label: 'Phone', value: canSeeAll ? '+1-555-0142' : null, hint: 'QE equality search available' },
                  { label: 'Account Reference', value: canSeeAll ? 'ACC-LF-20240115' : null, hint: 'Linked to this fraud case' },
                ].map(({ label, value, hint }) => (
                  <div key={label} className="flex items-center gap-2">
                    <EncryptionBadge label={label} type="qe-equality" />
                    {value ? (
                      <span className="text-green-700 font-mono text-xs">{value}</span>
                    ) : (
                      <span className="text-blue-600 text-xs italic">{hint}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* QE:none fields */}
            <div className={`p-3 ${canSeeAll ? 'bg-purple-50' : 'bg-gray-50'}`}>
              <p className={`text-xs font-semibold uppercase mb-2 ${canSeeAll ? 'text-purple-700' : 'text-gray-500'}`}>
                QE:none - Encrypted, not searchable - {canSeeAll ? 'L2 access granted' : 'L2 access required'}
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Physical Address', value: canSeeAll ? '742 Evergreen Terrace, Springfield' : null },
                  { label: 'Government ID', value: canSeeAll ? 'XXX-XX-4821 (masked)' : null },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <EncryptionBadge label={label} type="qe-none" />
                    {value ? (
                      <span className="text-green-700 font-mono text-xs">{value}</span>
                    ) : (
                      <span className="text-gray-400 text-xs italic">
                        Encrypted (QE:none) - accessible only after L2 escalation approval
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {!canSeeAll && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                  To access address and government ID, escalate this case to Level 2.
                  The L2 investigator decrypts these fields client-side using the DEK-sensitive key.
                </div>
              )}
            </div>
          </div>

          {/* Escalation action for L1 */}
          {canEscalate && (
            <div className="mt-3">
              <button
                onClick={handleEscalate}
                disabled={escalating}
                className="w-full py-2 px-4 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {escalating ? 'Escalating...' : 'Escalate to Level 2 Investigator'}
              </button>
              <p className="text-xs text-gray-500 mt-1 text-center">
                Escalating changes case status to &quot;escalated&quot; and notifies the L2 queue.
              </p>
            </div>
          )}
          {escalationDone && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700">
              Case escalated. An L2 investigator will review and approve access to sensitive fields.
            </div>
          )}

          {/* L2: additional investigation data */}
          {isL2 && (
            <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
              <p className="font-semibold text-purple-800 mb-2">L2 Investigator: Additional data sources</p>
              <ul className="text-xs text-purple-700 space-y-1 list-disc list-inside">
                <li>Full transaction lineage: query by card token at /api/v1/transactions?cardToken=...</li>
                <li>Customer payment cards: /api/v1/customer/:id/cards</li>
                <li>Raw gateway payload available in cardTransactionSensitive (requires DEK-sensitive)</li>
                <li>Processor transaction metadata available in cardTransactionSensitive</li>
              </ul>
              {debugMode && (
                <p className="text-xs mt-2 text-purple-600">
                  DEK-sensitive access requires escalation token in X-Escalation-Token header.
                  Token is issued by POST /api/v1/fraud/:id/escalate/approve
                </p>
              )}
            </div>
          )}
        </div>

        {/* Atlas Storage / Debug mode */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Atlas Storage</h2>
            <button onClick={toggleRaw} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors">
              {showRaw ? 'Business View' : 'View Raw Atlas Document'}
            </button>
          </div>

          {!showRaw && (
            <p className="text-sm text-gray-500">
              Toggle to see the actual ciphertext stored in MongoDB Atlas for the linked transaction.
              QE-encrypted fields appear as binary blobs - Atlas never holds plaintext PII.
            </p>
          )}

          {showRaw && rawDoc && (
            <>
              <RawDocumentPanel document={rawDoc} collection="cardTransaction" />
              {debugMode && (
                <div className="mt-3 bg-[#001E2B]/5 border border-[#001E2B]/20 rounded p-3 text-xs">
                  <p className="font-semibold mb-1">Debug - What this document demonstrates</p>
                  <ul className="space-y-0.5 text-gray-600 list-disc list-inside">
                    <li><code>cardTransactionAccountReference</code> stored as BSON binary (subType 06) - QE:equality ciphertext</li>
                    <li>Plaintext fields (amount, merchant, masked PAN) readable without any key</li>
                    <li>Atlas Data Explorer shows the same binary blobs - no plaintext PII visible server-side</li>
                    <li>Raw gateway payload is in cardTransactionSensitive (separate collection, DEK-sensitive)</li>
                  </ul>
                </div>
              )}
            </>
          )}

          {showRaw && !rawDoc && rawError && (
            <div className="bg-gray-900 text-green-300 rounded-lg p-4 font-mono text-xs">
              <div className="text-gray-400 mb-2">Atlas - cardTransaction - raw document</div>
              <div className="text-yellow-400 text-xs mb-3">
                Note: Live fetch failed ({rawError}). Showing representative demo document.
              </div>
              <pre className="whitespace-pre-wrap text-xs">{`{
  "_id": "...",
  "cardTransactionAccountReference": {
    "$binary": { "base64": "BhKJ9KMsQfY7lP+2Xa8nDE...", "subType": "06" }
  },
  "paymentCardReference": "tok_7xB2kp1q",
  "cardTransactionAmount": { "amount": 850, "currency": "USD" },
  "cardTransactionMerchantName": "Casino Royale",
  "cardTransactionMerchantCategoryCode": "7995",
  "cardTransactionDateTime": "2026-06-04T14:32:17.000Z",
  "cardTransactionStatus": "authorized"
}`}</pre>
              {debugMode && (
                <div className="mt-3 text-xs text-gray-500">
                  Live raw document fetch requires NODE_ENV=development in the backend.
                  Set DEMO_RAW_ENABLED=true in .env to override environment check.
                </div>
              )}
            </div>
          )}

          {showRaw && !rawDoc && !rawError && (
            <div className="text-sm text-gray-400">Loading raw document...</div>
          )}
        </div>

        {/* Audit Log */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3">Audit Log</h2>
          {events.length === 0 ? (
            <p className="text-sm text-gray-400">No events recorded for this case yet.</p>
          ) : (
            <div className="space-y-2">
              {events.map((e, i) => (
                <div key={i} className="flex gap-3 text-sm py-1.5 border-b last:border-0 items-start">
                  <span className="text-gray-400 font-mono text-xs whitespace-nowrap mt-0.5">
                    {new Date(e.actionDateTime).toLocaleString()}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${ACTION_TYPE_COLORS[e.actionType] ?? 'bg-gray-100 text-gray-700'}`}>
                    {ACTION_TYPE_LABELS[e.actionType] ?? e.actionType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-500 text-xs">{e.performedByRole}</span>
                  {debugMode && e.actionDetails && Object.keys(e.actionDetails).length > 0 && (
                    <span className="text-gray-400 text-xs font-mono ml-auto">
                      {JSON.stringify(e.actionDetails).slice(0, 60)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {debugMode && (
            <p className="text-xs text-gray-400 mt-2">
              Events stored in <code>fraudDiagnosisCaseEvents</code> collection (append-only).
              Retrieved via GET /api/v1/fraud/:id/events
            </p>
          )}
        </div>

        {/* PCI DSS context */}
        <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
          <strong>PCI DSS v4.0 alignment:</strong> Field-level access control via Queryable Encryption
          satisfies Requirements 3 (protect stored CHD), 7 (restrict access by business need), and
          10 (audit trail). Role boundaries are enforced at the DEK level, not just application logic.
        </div>
      </main>
    </div>
  );
}

function DemoHeader({
  role,
  debugMode,
  onToggleDebug,
}: {
  role: string;
  debugMode: boolean;
  onToggleDebug: () => void;
}) {
  return (
    <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between">
      <span className="font-bold text-[#00ED64]">🏦 Payment Gateway Demo</span>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleDebug}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            debugMode
              ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64]'
              : 'text-gray-400 border-white/20 hover:border-white/40'
          }`}
          title="Toggle debug mode - shows technical details about encryption and API calls"
        >
          {debugMode ? 'Debug ON' : 'Debug'}
        </button>
        <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-gray-300">
          {ROLE_LABELS[role] ?? role}
        </span>
        <Link href="/demo" className="text-sm text-gray-400 hover:text-white">Sign out</Link>
      </div>
    </header>
  );
}
