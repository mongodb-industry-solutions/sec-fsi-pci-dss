'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, RawDocumentResponse } from '../../../../../lib/api';
import { EncryptionBadge } from '../../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../../../../lib/constants';

export default function SimulatorCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawDoc, setRawDoc] = useState<RawDocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawLoading, setRawLoading] = useState(false);

  useEffect(() => {
    api.fraudCases.getById(caseId, '').then(setFraudCase).finally(() => setLoading(false));
  }, [caseId]);

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      setRawLoading(true);
      try {
        const doc = await api.demo.rawDocument(
          'cardTransactionQE',
          fraudCase.linkedCardTransactionReference,
          ''
        );
        setRawDoc(doc);
      } catch {
        setRawDoc(null);
      } finally {
        setRawLoading(false);
      }
    }
    setShowRaw((v) => !v);
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading case…</div>;
  if (!fraudCase) return <div className="text-center py-12 text-gray-500">Case not found.</div>;

  return (
    <div className="max-w-2xl space-y-5">
      <Link href="/simulator/investigation" className="text-sm text-blue-600 hover:underline">
        ← Back to cases
      </Link>

      {/* Case header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-xl font-bold">{fraudCase.caseReference}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[fraudCase.riskSeverity] ?? ''}`}>
            {fraudCase.riskSeverity.toUpperCase()}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[fraudCase.caseStatus] ?? ''}`}>
            {fraudCase.caseStatus.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          <div><span className="font-medium">Transaction ID:</span></div>
          <div className="font-mono text-xs truncate">{fraudCase.linkedCardTransactionReference.slice(0, 20)}…</div>
          <div><span className="font-medium">Risk Indicators:</span></div>
          <div>{fraudCase.fraudDiagnosisAssessment?.riskIndicators.join(', ') ?? '—'}</div>
          <div><span className="font-medium">Risk Score:</span></div>
          <div>{fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? '—'}/100</div>
        </div>
      </div>

      {/* Customer profile — QE field indicators */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 text-gray-800">Customer Profile</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Email" type="qe-equality" />
            <span className="text-gray-500 italic">[encrypted field: equality-searchable]</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Phone" type="qe-equality" />
            <span className="text-gray-500 italic">[encrypted field: equality-searchable]</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Account Reference" type="qe-equality" />
            <span className="text-gray-500 italic">[encrypted field: equality-searchable]</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t space-y-2 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            🔒 <strong>Address:</strong>
            <span className="italic">[Level 2 escalation required]</span>
          </div>
          <div className="flex items-center gap-2">
            🔒 <strong>Gov. ID:</strong>
            <span className="italic">[Level 2 escalation required]</span>
          </div>
        </div>
      </div>

      {/* Raw Atlas Document toggle */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Atlas Storage</h2>
          <button
            onClick={toggleRaw}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors"
          >
            {showRaw ? '👁 Business View' : '🔐 View Raw Atlas Document'}
          </button>
        </div>

        {rawLoading && <div className="text-sm text-gray-400">Fetching raw document from Atlas…</div>}

        {!showRaw && !rawLoading && (
          <p className="text-sm text-gray-500">
            Toggle to see the actual ciphertext stored in Atlas for the linked transaction.
            This uses a plain MongoClient with no auto-decryption.
          </p>
        )}

        {showRaw && rawDoc && (
          <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
        )}

        {showRaw && !rawDoc && !rawLoading && (
          <div className="bg-gray-900 text-green-300 rounded-lg p-4 font-mono text-xs">
            <div className="text-gray-400 mb-2">Atlas · cardTransactionQE · simulated ciphertext</div>
            <pre>{`{
  "_id": "...",
  "cardTransactionAccountReference": {
    "$binary": { "base64": "BhKJ9KMs...", "subType": "06" }
  },
  "paymentCardReference": "tok_7xB2kp1q",  ✅ plaintext (not CHD)
  "transactionAmount": { "amount": 850, "currency": "USD" }
}`}</pre>
          </div>
        )}
      </div>

      {/* Audit trail */}
      {fraudCase.diagnosisActionLog && fraudCase.diagnosisActionLog.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3 text-gray-800">📋 Action Log</h2>
          <div className="space-y-2">
            {fraudCase.diagnosisActionLog.map((event, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-gray-400 font-mono text-xs whitespace-nowrap">
                  {new Date(event.actionDateTime).toLocaleTimeString()}
                </span>
                <span className="font-medium">{event.actionType.replace(/_/g, ' ')}</span>
                <span className="text-gray-500">{event.performedByRole}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
