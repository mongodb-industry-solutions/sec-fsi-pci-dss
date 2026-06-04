'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS, ROLE_LABELS, formatRiskIndicator } from '../../../../lib/constants';

export default function DemoCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const token = getToken() ?? '';
  const payload = decodeToken(token);
  const role = payload?.role ?? 'level1_analyst';
  const isL2 = role === 'level2_investigator' || role === 'security_auditor';

  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawDoc, setRawDoc] = useState<Record<string, unknown> | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fraud.getById(caseId, token).then(setFraudCase).finally(() => setLoading(false));
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

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} />
      <main className="max-w-2xl mx-auto p-6">
        <div className="text-center py-12 text-gray-400">Loading case...</div>
      </main>
    </div>
  );

  if (!fraudCase) return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} />
      <main className="max-w-2xl mx-auto p-6">
        <div className="text-center py-12 text-gray-500">Case not found.</div>
      </main>
    </div>
  );

  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;

  const formattedAmount = snap
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: snap.cardTransactionAmount.currency,
      }).format(snap.cardTransactionAmount.amount)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <DemoHeader role={role} />
      <main className="max-w-2xl mx-auto p-6 space-y-5">
        <Link href="/demo/investigation" className="text-sm text-blue-600 hover:underline">
          Back to cases
        </Link>

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
              isL2
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
        </div>

        {/* Customer Profile - role-aware */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">Customer Profile</h2>
            <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${
              isL2 ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isL2 ? 'L2 Access' : 'L1 Access'}
            </span>
          </div>

          <div className="rounded-lg border divide-y text-sm">
            {/* QE:equality fields */}
            <div className="p-3 bg-blue-50">
              <p className="text-xs font-semibold text-blue-700 uppercase mb-2">
                Equality-searchable encrypted fields (QE:equality)
              </p>
              <p className="text-xs text-blue-600 mb-2">
                These fields are searchable in encrypted form. The server matches ciphertext without ever decrypting.
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Email', value: isL2 ? 'luis.fernandez@leafybank.demo' : null },
                  { label: 'Phone', value: isL2 ? '+1-555-0142' : null },
                  { label: 'Account Reference', value: isL2 ? 'ACC-LF-20240115' : null },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <EncryptionBadge label={label} type="qe-equality" />
                    {value ? (
                      <span className="text-green-700 font-mono text-xs">{value}</span>
                    ) : (
                      <span className="text-gray-400 text-xs italic">Equality-searchable - enter a value to search</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* QE:none fields */}
            <div className={`p-3 ${isL2 ? 'bg-purple-50' : 'bg-gray-50'}`}>
              <p className={`text-xs font-semibold uppercase mb-2 ${isL2 ? 'text-purple-700' : 'text-gray-500'}`}>
                Sensitive encrypted fields (QE:none) - {isL2 ? 'L2 access granted' : 'L2 access required'}
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Physical Address', value: isL2 ? '742 Evergreen Terrace, Springfield' : null },
                  { label: 'Government ID', value: isL2 ? 'XXX-XX-4821 (masked)' : null },
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
              {!isL2 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                  To access address and government ID, request escalation to Level 2.
                  An L2 investigator will review and, if approved, decrypt these fields client-side using the L2 DEK.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Atlas Storage */}
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
            <RawDocumentPanel document={rawDoc} collection="cardTransaction" />
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
              <div className="mt-3 text-xs text-gray-500">
                In production demos: ensure NODE_ENV=development in docker-compose to enable live fetch.
              </div>
            </div>
          )}

          {showRaw && !rawDoc && !rawError && (
            <div className="text-sm text-gray-400">Loading raw document...</div>
          )}
        </div>

        {/* Audit Log */}
        {fraudCase.diagnosisActionLog && fraudCase.diagnosisActionLog.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">Audit Log</h2>
            {fraudCase.diagnosisActionLog.map((e, i) => (
              <div key={i} className="flex gap-3 text-sm py-1.5 border-b last:border-0">
                <span className="text-gray-400 font-mono text-xs">{new Date(e.actionDateTime).toLocaleString()}</span>
                <span className="font-medium">{e.actionType.replace(/_/g, ' ')}</span>
                <span className="text-gray-500">{e.performedByRole}</span>
              </div>
            ))}
          </div>
        )}

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

function DemoHeader({ role }: { role: string }) {
  return (
    <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between">
      <span className="font-bold text-[#00ED64]">LeafyBank Demo</span>
      <div className="flex items-center gap-3">
        <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-gray-300">
          {ROLE_LABELS[role] ?? role}
        </span>
        <Link href="/demo" className="text-sm text-gray-400 hover:text-white">Sign out</Link>
      </div>
    </header>
  );
}
